package server

import (
	"context"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"github.com/YuarenArt/chatters/internal/logging"
	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

// CreateRoomResponse represents the response when creating a new room
// @Description Response structure for room creation
// CreateRoomRequest represents room creation parameters
type CreateRoomRequest struct {
	Name        string `json:"name,omitempty" example:"My Chat Room" description:"Room name (optional)"`
	Description string `json:"description,omitempty" example:"A place to chat with friends" description:"Room description (optional)"`
	MaxClients  int    `json:"max_clients,omitempty" example:"50" description:"Maximum number of clients (optional)"`
}

type CreateRoomResponse struct {
	RoomID websocket.ID `json:"room_id" example:"12345" description:"Unique room identifier"`
}

// RoomResponse represents basic room information
// @Description Response structure for room information
type RoomResponse struct {
	RoomID websocket.ID `json:"room_id" example:"12345" description:"Unique room identifier"`
}

// ErrorResponse represents error responses from the API
// @Description Standard error response structure
type ErrorResponse struct {
	Code  int    `json:"code" example:"400" description:"HTTP status code"`
	Error string `json:"error" example:"invalid_room_id" description:"Error identifier"`
}

type Server struct {
	Handler    websocket.Handler
	Engine     *gin.Engine
	Addr       string
	Middleware []gin.HandlerFunc
	Logger     logging.Logger
}

// Validation constants
const (
	MaxRoomID = 999999999 // Maximum room ID value
	MinRoomID = 1         // Minimum room ID value
)

func NewServer(addr string, handler websocket.Handler, serverLogger logging.Logger) *Server {
	apiLogger, _ := logging.NewFileLogger("logs/api.log", false)

	engine := gin.New()
	engine.Use(gin.Recovery())

	// Add CORS middleware
	engine.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Length, Content-Type, Authorization")
		c.Header("Access-Control-Expose-Headers", "Content-Length")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "43200") // 12 hours

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	// Add request size limit middleware
	engine.Use(func(c *gin.Context) {
		if c.Request.ContentLength > 10*1024*1024 { // 10MB limit
			c.JSON(http.StatusRequestEntityTooLarge, ErrorResponse{
				Code:  http.StatusRequestEntityTooLarge,
				Error: "request too large",
			})
			c.Abort()
			return
		}
		c.Next()
	})

	engine.Use(APILoggerMiddleware(apiLogger))

	s := &Server{
		Handler: handler,
		Engine:  engine,
		Addr:    addr,
		Logger:  serverLogger,
	}

	s.registerRoutes()

	engine.StaticFS("/static", http.Dir("web/static"))

	engine.GET("/", func(c *gin.Context) {
		c.File("web/static/index.html")
	})

	return s
}

// Health godoc
// @Summary Health check
// @Description Returns server health status and basic information
// @Tags health
// @Produce json
// @Success 200 {object} map[string]interface{} "Server health information"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/health [get]
func (s *Server) registerRoutes() {
	api := s.Engine.Group("/api")

	api.GET("/ws/:room_id", s.Handler.HandleWebSocket)
	api.POST("/rooms", s.CreateRoom())
	api.GET("/rooms/:room_id", s.Room())

	// Health and status endpoints
	s.Engine.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
		s.Logger.Log(c.Request.Context(), logging.Debug, "Health check", "status", "ok")
	})

	// Swagger documentation
	s.Engine.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	s.Logger.Log(context.Background(), logging.Debug, "Routes registered")
}

func (s *Server) Run(ctx context.Context) error {
	s.Logger.Log(ctx, logging.Info, "Starting server", "addr", s.Addr)
	return s.Engine.Run(s.Addr)
}

func (s *Server) Use(ctx context.Context, mw ...gin.HandlerFunc) {
	s.Middleware = append(s.Middleware, mw...)
	s.Engine.Use(mw...)
	s.Logger.Log(ctx, logging.Debug, "Middleware added", "count", len(mw))
}

// validateRoomID validates room ID format and range
func validateRoomID(roomIDStr string) (websocket.ID, error) {
	roomIDUint, err := strconv.ParseUint(roomIDStr, 10, 32)
	if err != nil {
		return 0, err
	}

	roomID := websocket.ID(roomIDUint)
	if roomID < MinRoomID || roomID > MaxRoomID {
		return 0, &ValidationError{Field: "room_id", Message: "room ID out of valid range"}
	}

	return roomID, nil
}

// ValidationError represents validation errors
// @Description Validation error structure for input validation failures
type ValidationError struct {
	Field   string `json:"field" example:"room_id" description:"Field that failed validation"`
	Message string `json:"message" example:"room ID out of valid range" description:"Validation error message"`
}

func (e *ValidationError) Error() string {
	return e.Message
}

func APILoggerMiddleware(logger logging.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := uuid.New().String()
		ctx := context.WithValue(c.Request.Context(), "request_id", requestID)
		c.Request = c.Request.WithContext(ctx)

		start := time.Now()
		path := c.Request.URL.Path
		method := c.Request.Method
		clientIP := c.ClientIP()
		contentLength := c.Request.ContentLength

		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		responseSize := c.Writer.Size()

		logger.Log(ctx, logging.Info, "HTTP request",
			"method", method,
			"path", path,
			"status", status,
			"latency", latency.String(),
			"client_ip", clientIP,
			"content_length", contentLength,
			"response_size", responseSize,
		)
	}
}

// CreateRoom godoc
// @Summary Create a new room
// @Description Generates and creates a new room with a random ID. The room will be immediately available for WebSocket connections. Room IDs are generated randomly between 1 and 999,999,999.
// @Tags rooms
// @Accept json
// @Produce json
// @Param room body CreateRoomRequest false "Room configuration (optional)"
// @Success 201 {object} CreateRoomResponse "Room created successfully"
// @Failure 400 {object} ErrorResponse "Invalid request parameters"
// @Failure 409 {object} ErrorResponse "Room creation conflict"
// @Failure 500 {object} ErrorResponse "Internal server error during room creation"
// @Router /api/rooms [post]
func (s *Server) CreateRoom() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		s.Logger.Log(ctx, logging.Info, "CreateRoom request received",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent())

		// Parse request body
		var req CreateRoomRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			s.Logger.Log(ctx, logging.Warn, "Invalid request body", "error", err.Error())
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid_request",
			})
			return
		}

		var roomID websocket.ID
		var created bool
		maxRetries := 100

		for i := 0; i < maxRetries; i++ {
			roomID = websocket.ID(rand.Uint32())
			if roomID < MinRoomID || roomID > MaxRoomID {
				continue
			}

			_, created = s.Handler.Hub.CreateRoom(roomID)
			if created {
				break
			}
		}

		if !created {
			s.Logger.Log(ctx, logging.Error, "Failed to create room after retries",
				"max_retries", maxRetries)
			c.JSON(http.StatusInternalServerError, ErrorResponse{
				Code:  http.StatusInternalServerError,
				Error: "room_creation_failed",
			})
			return
		}

		s.Logger.Log(ctx, logging.Info, "Room created successfully",
			"room_id", roomID, "retries", maxRetries)
		c.JSON(http.StatusCreated, CreateRoomResponse{RoomID: roomID})
	}
}

// Room godoc
// @Summary Get room information
// @Description Returns basic room information including client count and status by room ID. Room ID must be between 1 and 999,999,999.
// @Tags rooms
// @Accept json
// @Produce json
// @Param room_id path int true "Room ID (1-999999999)" minimum(1) maximum(999999999)
// @Success 200 {object} RoomResponse "Room information retrieved successfully"
// @Failure 400 {object} ErrorResponse "Invalid room ID format or out of range"
// @Failure 404 {object} ErrorResponse "Room not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/rooms/{room_id} [get]
func (s *Server) Room() func(c *gin.Context) {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		roomIDStr := c.Param("room_id")

		s.Logger.Log(ctx, logging.Info, "Room info request received",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"room_id", roomIDStr,
			"client_ip", c.ClientIP(),
			"user_agent", c.Request.UserAgent())

		roomID, err := validateRoomID(roomIDStr)
		if err != nil {
			s.Logger.Log(ctx, logging.Warn, "Invalid room ID provided",
				"room_id", roomIDStr, "error", err.Error())
			c.JSON(http.StatusBadRequest, ErrorResponse{
				Code:  http.StatusBadRequest,
				Error: "invalid room ID format or out of range",
			})
			return
		}

		room, exists := s.Handler.Hub.GetRoom(roomID)
		if !exists {
			s.Logger.Log(ctx, logging.Info, "Room not found",
				"room_id", roomID, "requested_id", roomIDStr)
			c.JSON(http.StatusNotFound, ErrorResponse{
				Code:  http.StatusNotFound,
				Error: "room not found",
			})
			return
		}

		s.Logger.Log(ctx, logging.Info, "Room info retrieved successfully",
			"room_id", roomID, "client_count", room.GetClientCount())
		c.JSON(http.StatusOK, RoomResponse{RoomID: room.ID})
	}
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.Logger.Log(ctx, logging.Info, "Shutting down server")

	s.Handler.Hub.Rooms.Range(func(key, value any) bool {
		room := value.(*websocket.Room)
		room.StopRoom()
		return true
	})

	s.Handler.Pool.Release()
	return nil
}
