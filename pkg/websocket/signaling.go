package websocket

import (
	"encoding/json"
	"log"
)

// HandlerFunc processes a signaling message
type HandlerFunc func(c *Client, msg Message)

// SignalingHandler routes messages by type
type SignalingHandler struct {
	handlers map[string]HandlerFunc
}

func NewSignalingHandler() *SignalingHandler {
	return &SignalingHandler{
		handlers: make(map[string]HandlerFunc),
	}
}

// Register new handler for message type
func (s *SignalingHandler) Register(msgType string, fn HandlerFunc) {
	s.handlers[msgType] = fn
}

// Handle incoming message
func (s *SignalingHandler) Handle(c *Client, msg Message) {
	if fn, ok := s.handlers[msg.Type]; ok {
		fn(c, msg)
	} else {
		// default: broadcast raw message
		c.Room.Broadcast <- mustMarshal(msg)
	}
}

func mustMarshal(v interface{}) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return nil
	}
	return b
}
