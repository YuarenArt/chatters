package websocket

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	readDeadline = 5 * time.Minute
	// Message validation constants
	MaxMessageSize = 1024 * 1024 // 1MB
	MaxTextLength  = 1000        // Maximum text length for chat messages
)

type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type ChatMessage struct {
	Text     string `json:"text"`
	Username string `json:"username"`
}

type JoinPayload struct {
	Username string `json:"username"`
}

type JoinNotification struct {
	Username    string `json:"username"`
	OnlineCount int    `json:"onlineCount"`
}

type LeaveNotification struct {
	Username    string `json:"username"`
	OnlineCount int    `json:"onlineCount"`
}

type Client struct {
	Conn     *websocket.Conn
	Send     chan []byte
	Room     *Room
	Username string
}

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

		if message.Type == "chat" {

			var data map[string]interface{}
			if err := json.Unmarshal(message.Data, &data); err != nil {
				continue
			}

			text, ok := data["text"].(string)
			if !ok {
				continue
			}

			chatMsg := ChatMessage{
				Text:     text,
				Username: c.Username,
			}

			log.Printf("✅ Создано сообщение: %+v", chatMsg)

			chatData, _ := json.Marshal(chatMsg)
			message.Data = chatData

			if newMsg, err := json.Marshal(message); err == nil {
				c.Room.Broadcast <- newMsg
			}
		} else {
			c.Room.Broadcast <- msg
		}
	}
}

func (c *Client) Write() {
	defer c.Conn.Close()
	for {
		msg, ok := <-c.Send
		if !ok {
			c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}

		err := c.Conn.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			break
		}
	}
}
