package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	readDeadline   = 5 * time.Minute
	MaxMessageSize = 1 * 1024 * 1024 // 1MB
	MaxTextLength  = 1000
)

type Client struct {
	Conn      *websocket.Conn
	Send      chan []byte
	Room      *Room
	Username  string
	closeOnce sync.Once
	IsHost    bool
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
		case "kick":
			if !c.IsHost {
				log.Printf("Non-host %s attempted to send kick message", c.Username)
				continue
			}
			var kick KickMessage
			if err := json.Unmarshal(message.Data, &kick); err != nil {
				log.Printf("Failed to unmarshal kick message: %v", err)
				continue
			}
			c.handleKickMessage(kick)
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

func (c *Client) handleKickMessage(kick KickMessage) {
	if kick.TargetUsername == c.Username {
		return
	}

	c.Room.mu.RLock()
	var target *Client
	for client := range c.Room.Clients {
		if client.Username == kick.TargetUsername {
			target = client
			break
		}
	}
	c.Room.mu.RUnlock()

	if target == nil {
		log.Printf("Target user %s not found in room %d", kick.TargetUsername, c.Room.ID)
		return
	}

	target.closeOnce.Do(func() {
		close(target.Send)
	})
	target.Conn.Close()
	c.Room.Unregister <- target

	notification := KickNotification{
		TargetUsername: kick.TargetUsername,
		KickedBy:       c.Username,
	}
	notificationData, _ := json.Marshal(notification)
	broadcastMsg := Message{
		Type: "kick",
		Data: notificationData,
	}
	broadcastData, _ := json.Marshal(broadcastMsg)
	c.Room.Broadcast <- broadcastData

	log.Printf("User %s kicked by %s in room %d", kick.TargetUsername, c.Username, c.Room.ID)
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
