package websocket

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/suite"
)

type ClientTestSuite struct {
	suite.Suite
	room     *Room
	client   *Client
	server   *httptest.Server
	wsConn   *websocket.Conn
	taskPool *TaskPool
	wg       sync.WaitGroup
}

func (s *ClientTestSuite) SetupTest() {
	s.room = NewRoom(1)
	go s.room.Run()

	var err error
	s.taskPool, err = NewTaskPool(10)
	s.NoError(err)

	hub := NewHub()
	handler := NewHandler(hub, s.taskPool)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/ws", func(c *gin.Context) {
		hub.Rooms.Store(ID(1), s.room)
		conn, err := handler.Upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upgrade"})
			return
		}
		s.client = &Client{
			Conn:     conn,
			Send:     make(chan []byte, 256),
			Room:     s.room,
			Username: "testuser",
		}
		s.room.Register <- s.client

		s.NoError(s.taskPool.Submit(func() { s.client.Read() }))
		s.NoError(s.taskPool.Submit(func() { s.client.Write() }))
	})

	s.server = httptest.NewServer(engine)
	wsURL := "ws" + strings.TrimPrefix(s.server.URL, "http") + "/ws"

	s.wsConn, _, err = websocket.DefaultDialer.Dial(wsURL, nil)
	s.NoError(err)

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			if s.room.GetClientCount() > 0 {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	s.wg.Wait()
}

func (s *ClientTestSuite) TearDownTest() {
	s.room.StopRoom()
	s.taskPool.Release()
	s.server.Close()
}

func (s *ClientTestSuite) TestReadChatMessage() {
	chatMsg := ChatMessage{Text: "Hello", Username: s.client.Username}
	data, _ := json.Marshal(chatMsg)
	msg := Message{Type: "chat", Data: data}
	msgBytes, _ := json.Marshal(msg)

	err := s.wsConn.WriteMessage(websocket.TextMessage, msgBytes)
	s.NoError(err)

	deadline := time.Now().Add(2 * time.Second)
	for {
		if time.Now().After(deadline) {
			s.Fail("Timeout waiting for chat message via websocket")
			return
		}

		_ = s.wsConn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		_, raw, err := s.wsConn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure) || !strings.Contains(err.Error(), "i/o timeout") {
				s.T().Logf("ReadMessage error: %v", err)
				s.FailNow("Unexpected websocket read error")
				return
			}
			continue
		}

		var received Message
		if err := json.Unmarshal(raw, &received); err != nil {
			continue
		}

		if received.Type != "chat" {
			continue
		}

		var receivedChat ChatMessage
		s.NoError(json.Unmarshal(received.Data, &receivedChat))
		s.Equal(chatMsg.Text, receivedChat.Text)
		s.Equal(s.client.Username, receivedChat.Username)
		return
	}
}

func (s *ClientTestSuite) TestWriteMessage() {
	msg := []byte(`{"type":"test","data":"testdata"}`)

	_, _, err := s.wsConn.ReadMessage()
	s.NoError(err)

	s.client.Send <- msg

	_, received, err := s.wsConn.ReadMessage()
	s.NoError(err)
	s.Equal(msg, received)
}

func TestClientTestSuite(t *testing.T) {
	suite.Run(t, new(ClientTestSuite))
}
