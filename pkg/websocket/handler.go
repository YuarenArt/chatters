package websocket

import (
	"encoding/json"
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

// Message Base message structure
// @Description Generic message wrapper for WebSocket communication
type Message struct {
	Type string          `json:"type"` // chat, join, leave, etc.
	Data json.RawMessage `json:"data"`
}

// ChatMessage Chat message payload
// @Description Payload for chat messages
type ChatMessage struct {
	Text     string `json:"text" example:"Hello world!"`
	Username string `json:"username" example:"JohnDoe"`
}

// JoinPayload Join/Leave payloads
// @Description Payload sent when a user joins or leaves a room
type JoinPayload struct {
	Username string `json:"username" example:"JohnDoe"`
}

// JoinNotification Sent to clients when a user joins
type JoinNotification struct {
	Username    string `json:"username" example:"JohnDoe"`
	OnlineCount int    `json:"onlineCount" example:"5"`
}

// LeaveNotification Sent to clients when a user leaves
type LeaveNotification struct {
	Username    string `json:"username" example:"JohnDoe"`
	OnlineCount int    `json:"onlineCount" example:"4"`
}

// ErrorResponse Standard error response
type ErrorResponse struct {
	Code    int    `json:"code" example:"400"`
	Message string `json:"message" example:"Invalid request"`
}

// ValidationError Field-specific validation error
type ValidationError struct {
	Field   string `json:"field" example:"username"`
	Message string `json:"message" example:"username is too short"`
}

func (e *ValidationError) Error() string {
	return e.Message
}

type Handler struct {
	Hub              *Hub
	Upgrader         websocket.Upgrader
	Pool             *TaskPool
	SignalingHandler *SignalingHandler
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
		SignalingHandler: NewSignalingHandler(),
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

// HandleWebSocket godoc
// @Summary Connect to WebSocket room
// @Description Opens a WebSocket connection to the specified room. Optionally provide a username.
// @Tags websocket
// @Param room_id path int true "Room ID (1-999999999)"
// @Param username query string false "Username for chat. If omitted, 'Anonymous' is used"
// @Success 101 {string} string "Switching Protocols (WebSocket upgraded)"
// @Failure 400 {object} ErrorResponse "Bad request or validation error"
// @Failure 404 {object} ErrorResponse "Room not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /ws/{room_id} [get]
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
