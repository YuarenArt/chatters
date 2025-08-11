package websocket

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	bufferSize = 256

	MaxUsernameLength = 50
	MinUsernameLength = 4
)

// ErrorResponse represents error responses
type ErrorResponse struct {
	Code  int    `json:"code"`
	Error string `json:"error"`
}

type Handler struct {
	Hub      *Hub
	Upgrader websocket.Upgrader
	Pool     *TaskPool
}

func NewHandler(hub *Hub, pool *TaskPool) *Handler {
	return &Handler{
		Hub:  hub,
		Pool: pool,
		Upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// validateUsername validates username format and length
func validateUsername(username string) error {
	if len(strings.TrimSpace(username)) < MinUsernameLength {
		return &ValidationError{Field: "username", Message: "username is too short"}
	}
	if len(username) > MaxUsernameLength {
		return &ValidationError{Field: "username", Message: "username is too long"}
	}
	// Check for potentially dangerous characters
	if strings.ContainsAny(username, "<>\"'&") {
		return &ValidationError{Field: "username", Message: "username contains invalid characters"}
	}
	return nil
}

// ValidationError represents validation errors
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *ValidationError) Error() string {
	return e.Message
}

// HandleWebSocket godoc
// @Summary Connect to WebSocket room
// @Description Opens WebSocket connection to the specified room
// @Tags websocket
// @Produce json
// @Param room_id  path  int  true  "Room ID"
// @Param username query string false "Username for the chat"
// @Success 101 {string} string  "Switching Protocols"
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router api/ws/{room_id} [get]
func (h *Handler) HandleWebSocket(c *gin.Context) {
	roomIDStr := c.Param("room_id")

	// Validate room ID
	roomIDUint, err := strconv.ParseUint(roomIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "invalid room ID format",
		})
		return
	}

	roomID := ID(roomIDUint)
	if roomID < 1 || roomID > 999999999 {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": "room ID out of valid range",
		})
		return
	}

	room, ok := h.Hub.GetRoom(roomID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{
			"code":  http.StatusNotFound,
			"error": "room not found",
		})
		return
	}

	username := strings.TrimSpace(c.Query("username"))
	if username != "" {
		if err := validateUsername(username); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"code":  http.StatusBadRequest,
				"error": err.Error(),
			})
			return
		}
	} else {
		username = "Anonymous" // Default username
	}

	conn, err := h.Upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":  http.StatusInternalServerError,
			"error": "failed to upgrade websocket connection",
		})
		return
	}

	client := &Client{
		Conn:     conn,
		Send:     make(chan []byte, bufferSize),
		Room:     room,
		Username: username,
	}

	room.Register <- client

	if err := h.Pool.Submit(func() {
		client.Write()
	}); err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"write task failed"}`))
	}

	if err := h.Pool.Submit(func() {
		client.Read()
	}); err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"read task failed"}`))
	}
}
