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

	DefaultName = "Anonymous"
)

// ErrorResponse represents error responses
// @Description WebSocket error response structure
type ErrorResponse struct {
	Code  int    `json:"code" example:"400" description:"HTTP status code"`
	Error string `json:"error" example:"invalid_room_id" description:"Error identifier"`
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
// @Description Validation error structure for input validation failures
type ValidationError struct {
	Field   string `json:"field" example:"username" description:"Field that failed validation"`
	Message string `json:"message" example:"username is too short" description:"Validation error message"`
}

func (e *ValidationError) Error() string {
	return e.Message
}

// HandleWebSocket godoc
// @Summary Connect to WebSocket room
// @Description Opens WebSocket connection to the specified room for real-time chat communication. Supports chat messages, join/leave notifications, and real-time updates.
// @Tags websocket
// @Produce json
// @Param room_id path int true "Room ID (1-999999999)" minimum(1) maximum(999999999)
// @Param username query string false "Username for the chat (4-50 characters, defaults to 'Anonymous')" minlength(4) maxlength(50)
// @Success 101 {string} string "Switching Protocols - WebSocket connection established"
// @Failure 400 {object} ErrorResponse "Invalid room ID format, out of range, or invalid username"
// @Failure 404 {object} ErrorResponse "Room not found"
// @Failure 500 {object} ErrorResponse "Internal server error during WebSocket upgrade"
// @Router /api/ws/{room_id} [get]
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
		username = DefaultName
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
