package websocket

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

const (
	bufferSize = 256

	MaxUsernameLength = 50
	MinUsernameLength = 4

	DefaultName = "Anonymous"
)

type Handler struct {
	Hub              *Hub
	Pool             *TaskPool
	SignalingHandler *SignalingHandler
	Upgrader         websocket.Upgrader
}

func NewHandler(hub *Hub, pool *TaskPool) *Handler {
	return &Handler{
		Hub:  hub,
		Pool: pool,
		Upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
		SignalingHandler: NewSignalingHandler(),
	}
}

// checkPasswordHash compares a password with its hash
func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// validateUsername validates username format and length
func validateUsername(username string) error {
	if len(strings.TrimSpace(username)) < MinUsernameLength {
		return &ValidationError{Field: "username", Message: "username is too short"}
	}
	if len(username) > MaxUsernameLength {
		return &ValidationError{Field: "username", Message: "username is too long"}
	}
	if strings.ContainsAny(username, "<>\"'&") {
		return &ValidationError{Field: "username", Message: "username contains invalid characters"}
	}
	return nil
}

// validateRoomID validates and parses room ID from string
func validateRoomID(roomIDStr string) (ID, error) {
	roomIDUint, err := strconv.ParseUint(roomIDStr, 10, 32)
	if err != nil {
		return 0, &ValidationError{Field: "room_id", Message: "invalid room ID format"}
	}
	roomID := ID(roomIDUint)
	if roomID < 1 || roomID > 999999999 {
		return 0, &ValidationError{Field: "room_id", Message: "room ID out of valid range"}
	}
	return roomID, nil
}

// processUsername validates and returns username or default
func processUsername(username string) (string, error) {
	username = strings.TrimSpace(username)
	if username != "" {
		if err := validateUsername(username); err != nil {
			return "", err
		}
		return username, nil
	}
	return DefaultName, nil
}

// validateRoomPassword checks if provided password matches room password
func validateRoomPassword(room *Room, providedPassword string) error {
	if room.HashedPassword == "" {
		return nil
	}
	if providedPassword == "" || !checkPasswordHash(providedPassword, room.HashedPassword) {
		return &ValidationError{Field: "password", Message: "invalid or missing password"}
	}
	return nil
}

// validateHostToken validates JWT token and checks if user is host
func validateHostToken(hostToken, roomIDStr, jwtSecret string, room *Room) (bool, error) {
	if hostToken == "" {
		return false, nil
	}
	token, err := jwt.Parse(hostToken, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(jwtSecret), nil
	})
	if err != nil || !token.Valid {
		return false, nil
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false, nil
	}
	if roomIDStr != fmt.Sprintf("%v", claims["room_id"]) || claims["host"] != true {
		return false, nil
	}
	hostIDClaim, exists := claims["host_id"]
	if !exists {
		return false, nil
	}
	hostIDStr, ok := hostIDClaim.(string)
	if !ok || hostIDStr != room.HostID {
		return false, nil
	}
	return true, nil
}

// upgradeConnection upgrades HTTP connection to WebSocket
func (h *Handler) upgradeConnection(c *gin.Context) (*websocket.Conn, error) {
	return h.Upgrader.Upgrade(c.Writer, c.Request, nil)
}

// createClient creates a new WebSocket client
func createClient(conn *websocket.Conn, room *Room, username string, isHost bool) *Client {
	return &Client{
		Conn:     conn,
		Send:     make(chan []byte, bufferSize),
		Room:     room,
		Username: username,
		IsHost:   isHost,
	}
}

// startClientTasks starts read and write tasks for the client
func (h *Handler) startClientTasks(client *Client) error {
	if err := h.Pool.Submit(func() {
		client.Write()
	}); err != nil {
		client.Conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"write task failed"}`))
		return err
	}
	if err := h.Pool.Submit(func() {
		client.Read()
	}); err != nil {
		client.Conn.WriteMessage(websocket.TextMessage, []byte(`{"error":"read task failed"}`))
		return err
	}
	return nil
}

// HandleWebSocketWithJWT creates a handler function with JWT secret
func (h *Handler) HandleWebSocketWithJWT(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		h.handleWebSocket(c, jwtSecret)
	}
}

// HandleWebSocket godoc
// @Summary Connect to WebSocket room
// @Description Opens a WebSocket connection to the specified room. Optionally provide a username.
// @Tags websocket
// @Param room_id path int true "Room ID (1-999999999)"
// @Param username query string false "Username for chat. If omitted, 'Anonymous' is used"
// @Param password query string false "Room password if required"
// @Param host_token query string false "Host token for room management privileges"
// @Success 101 {string} string "Switching Protocols (WebSocket upgraded)"
// @Failure 400 {object} ErrorResponse "Bad request or validation error"
// @Failure 401 {object} ErrorResponse "Unauthorized - invalid password or host token"
// @Failure 404 {object} ErrorResponse "Room not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /ws/{room_id} [get]
func (h *Handler) handleWebSocket(c *gin.Context, jwtSecret string) {
	roomIDStr := c.Param("room_id")

	roomID, err := validateRoomID(roomIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": err.Error(),
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

	username, err := processUsername(c.Query("username"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  http.StatusBadRequest,
			"error": err.Error(),
		})
		return
	}

	if err := validateRoomPassword(room, c.Query("password")); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":  http.StatusUnauthorized,
			"error": err.Error(),
		})
		return
	}

	isHost, err := validateHostToken(c.Query("host_token"), roomIDStr, jwtSecret, room)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":  http.StatusUnauthorized,
			"error": "invalid host token",
		})
		return
	}

	conn, err := h.upgradeConnection(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":  http.StatusInternalServerError,
			"error": "failed to upgrade websocket connection",
		})
		return
	}

	client := createClient(conn, room, username, isHost)
	room.Register <- client
	h.startClientTasks(client)
}
