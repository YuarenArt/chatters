package websocket

import "encoding/json"

// Message Base message structure
// @Description Generic message wrapper for WebSocket communication
type Message struct {
	Type string          `json:"type"` // chat, join, leave, kick etc.
	Data json.RawMessage `json:"data"`
}

// ChatMessage Chat message payload
// @Description Payload for chat messages
type ChatMessage struct {
	Text     string `json:"text" example:"Hello world!"`
	Username string `json:"username" example:"JohnDoe"`
}

// KickMessage Payload for kicking a user
// @Description Payload sent when a host kicks a user from the room
type KickMessage struct {
	TargetUsername string `json:"target_username" example:"JohnDoe"`
}

// JoinPayload Join/Leave payloads
// @Description Payload sent when a user joins or leaves a room
type JoinPayload struct {
	Username string `json:"username" example:"JohnDoe"`
}

// KickNotification Sent to clients when a user is kicked
type KickNotification struct {
	TargetUsername string `json:"target_username" example:"JohnDoe"`
	KickedBy       string `json:"kicked_by" example:"HostUser"`
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
	Message string `json:"message" example:"Invalid request"`
	Code    int    `json:"code" example:"400"`
}

// ValidationError Field-specific validation error
type ValidationError struct {
	Field   string `json:"field" example:"username"`
	Message string `json:"message" example:"username is too short"`
}

func (e ValidationError) Error() string {
	return e.Message
}
