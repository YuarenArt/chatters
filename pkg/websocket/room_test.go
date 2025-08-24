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

type RoomTestSuite struct {
	suite.Suite
	room      *Room
	server    *httptest.Server
	wsConn    *websocket.Conn
	wg        sync.WaitGroup
	signaling *SignalingHandler
}

func (s *RoomTestSuite) SetupTest() {
	s.room = NewRoom(1)
	go s.room.Run()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	upgrader := websocket.Upgrader{}
	engine.GET("/ws", func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		client := &Client{
			Conn:     conn,
			Send:     make(chan []byte, 256),
			Room:     s.room,
			Username: "testuser",
		}
		s.room.Register <- client
		s.signaling = NewSignalingHandler()
		go client.Read()
		go client.Write()
	})

	s.server = httptest.NewServer(engine)
	wsURL := "ws" + strings.TrimPrefix(s.server.URL, "http") + "/ws"

	var err error
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

func (s *RoomTestSuite) TearDownTest() {
	s.room.StopRoom()
	s.server.Close()
}

func (s *RoomTestSuite) TestRegisterClient() {
	s.Equal(1, s.room.GetClientCount())
}

func (s *RoomTestSuite) TestBroadcastJoinNotification() {
	messageType, msg, err := s.wsConn.ReadMessage()
	s.NoError(err)
	s.Equal(websocket.TextMessage, messageType)

	var message Message
	s.NoError(json.Unmarshal(msg, &message))
	s.Equal("join", message.Type)

	var notification JoinNotification
	s.NoError(json.Unmarshal(message.Data, &notification))
	s.Equal("testuser", notification.Username)
	s.Equal(1, notification.OnlineCount)
}

func (s *RoomTestSuite) waitForClientCount(expected int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.room.GetClientCount() == expected {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

func (s *RoomTestSuite) TestUnregisterClient() {
	s.wsConn.Close()

	ok := s.waitForClientCount(0, 2*time.Second)
	s.True(ok, "Timeout waiting for client to unregister")
}

func TestRoomTestSuite(t *testing.T) {
	suite.Run(t, new(RoomTestSuite))
}
