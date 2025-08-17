package websocket

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	readDeadline   = 5 * time.Minute
	MaxMessageSize = 1024 * 1024 // 1MB
	MaxTextLength  = 1000
)

type Client struct {
	Conn     *websocket.Conn
	Send     chan []byte
	Room     *Room
	Username string
}

// Read reads messages from WebSocket connection
func (c *Client) Read() {
	defer func() {
		c.Room.Unregister <- c
		c.Conn.Close()
	}()

	for {
		c.Conn.SetReadDeadline(time.Now().Add(readDeadline))
		_, msg, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var message Message
		if err := json.Unmarshal(msg, &message); err != nil {
			continue
		}

		switch message.Type {
		case "chat":
			c.handleChatMessage(message)
		default:
			c.Room.Broadcast <- msg
		}
	}
}

func (c *Client) handleChatMessage(message Message) {
	var chat ChatMessage
	if err := json.Unmarshal(message.Data, &chat); err != nil {
		return
	}

	chat.Username = c.Username

	log.Printf("hat message created: %+v", chat)

	chatData, _ := json.Marshal(chat)
	message.Data = chatData

	if newMsg, err := json.Marshal(message); err == nil {
		c.Room.Broadcast <- newMsg
	}
}

// Write writes messages to WebSocket connection
func (c *Client) Write() {
	defer c.Conn.Close()

	for msg := range c.Send {
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
}
