package websocket_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/gin-gonic/gin"
	gorillaWs "github.com/gorilla/websocket"
	"github.com/stretchr/testify/suite"
)

type ClientTestSuite struct {
	suite.Suite
	room      *websocket.Room
	client    *websocket.Client
	server    *httptest.Server
	wsConn    *gorillaWs.Conn
	taskPool  *websocket.TaskPool
	signaling *websocket.SignalingHandler
	wg        sync.WaitGroup
}

func (s *ClientTestSuite) SetupTest() {
	s.room = websocket.NewRoom(1, nil)
	go s.room.Run()

	var err error
	s.taskPool, err = websocket.NewTaskPool(10)
	s.NoError(err)

	hub := websocket.NewHub()
	handler := websocket.NewHandler(hub, s.taskPool)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/ws", func(c *gin.Context) {
		hub.Rooms.Store(websocket.ID(1), s.room)
		conn, err := handler.Upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upgrade"})
			return
		}
		s.client = &websocket.Client{
			Conn:     conn,
			Send:     make(chan []byte, 256),
			Room:     s.room,
			Username: "testuser",
		}
		s.room.Register <- s.client
		s.signaling = websocket.NewSignalingHandler()
		s.NoError(s.taskPool.Submit(func() { s.client.Read() }))
		s.NoError(s.taskPool.Submit(func() { s.client.Write() }))
	})

	s.server = httptest.NewServer(engine)
	wsURL := "ws" + strings.TrimPrefix(s.server.URL, "http") + "/ws"

	s.wsConn, _, err = gorillaWs.DefaultDialer.Dial(wsURL, nil)
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
	chatMsg := websocket.ChatMessage{Text: "Hello", Username: s.client.Username}
	data, _ := json.Marshal(chatMsg)
	msg := websocket.Message{Type: "chat", Data: data}
	msgBytes, _ := json.Marshal(msg)

	err := s.wsConn.WriteMessage(gorillaWs.TextMessage, msgBytes)
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
			if gorillaWs.IsUnexpectedCloseError(err, gorillaWs.CloseNormalClosure) || !strings.Contains(err.Error(), "i/o timeout") {
				s.T().Logf("ReadMessage error: %v", err)
				s.FailNow("Unexpected websocket read error")
				return
			}
			continue
		}

		var received websocket.Message
		if err := json.Unmarshal(raw, &received); err != nil {
			continue
		}

		if received.Type != "chat" {
			continue
		}

		var receivedChat websocket.ChatMessage
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
