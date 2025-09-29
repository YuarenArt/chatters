package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	readDeadline   = 1 * time.Minute
	pingPeriod     = (readDeadline * 9) / 10
	MaxMessageSize = 1 * 1024 * 1024 // 1MB
	MaxTextLength  = 1000
	writeDeadline  = 10 * time.Second
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

	c.Conn.SetReadLimit(MaxMessageSize)

	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(readDeadline))
		return nil
	})
	go c.startPing()

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

	if len(chat.Text) > MaxTextLength {
		log.Printf("Chat message too long from %s: %d chars", c.Username, len(chat.Text))
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
	defer func() {
		c.closeOnce.Do(func() {
			close(c.Send)
		})
		c.Conn.Close()
	}()

	for msg := range c.Send {
		c.Conn.SetWriteDeadline(time.Now().Add(writeDeadline))
		if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Printf("Write failed for client %s: %v", c.Username, err)
			c.Room.Unregister <- c
			return
		}
	}
}

func (c *Client) startPing() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if err := c.Conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(10*time.Second)); err != nil {
				log.Printf("Ping failed for client %s: %v", c.Username, err)
				c.Room.Unregister <- c
				return
			}
		case <-c.Room.Stop:
			return
		}
	}
}

func (c *Client) isClosed() bool {
	select {
	case _, ok := <-c.Send:
		return !ok
	default:
		return false
	}
}
