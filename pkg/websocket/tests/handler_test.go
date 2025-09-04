package websocket_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/gin-gonic/gin"
	gorillaWs "github.com/gorilla/websocket"
	"github.com/stretchr/testify/suite"
)

type HandlerTestSuite struct {
	suite.Suite
	handler *websocket.Handler
	hub     *websocket.Hub
	pool    *websocket.TaskPool
	engine  *gin.Engine
}

func (s *HandlerTestSuite) SetupTest() {
	s.hub = websocket.NewHub()
	var err error
	s.pool, err = websocket.NewTaskPool(10)
	s.NoError(err)
	s.handler = websocket.NewHandler(s.hub, s.pool)
	s.engine = gin.New()
	s.engine.GET("/api/ws/:room_id", s.handler.HandleWebSocketWithJWT("test-secret"))
}

func (s *HandlerTestSuite) TearDownTest() {
	s.pool.Release()
}

func (s *HandlerTestSuite) TestHandleWebSocketInvalidRoomID() {
	req, _ := http.NewRequest("GET", "/api/ws/invalid", nil)
	w := httptest.NewRecorder()
	s.engine.ServeHTTP(w, req)

	s.Equal(http.StatusBadRequest, w.Code)
	s.Contains(w.Body.String(), "invalid room ID format")
}

func (s *HandlerTestSuite) TestHandleWebSocketRoomNotFound() {
	req, _ := http.NewRequest("GET", "/api/ws/999", nil)
	w := httptest.NewRecorder()
	s.engine.ServeHTTP(w, req)

	s.Equal(http.StatusNotFound, w.Code)
	s.Contains(w.Body.String(), "room not found")
}

func (s *HandlerTestSuite) TestHandleWebSocketValidUsername() {
	s.hub.CreateRoom(1, nil)

	server := httptest.NewServer(s.engine)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/ws/1?username=testuser"
	conn, _, err := gorillaWs.DefaultDialer.Dial(wsURL, nil)
	s.NoError(err)
	defer conn.Close()

	time.Sleep(1 * time.Second)

	room, _ := s.hub.GetRoom(1)
	s.Equal(1, room.GetClientCount())
}

func TestHandlerTestSuite(t *testing.T) {
	suite.Run(t, new(HandlerTestSuite))
}
