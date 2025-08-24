package websocket

import "encoding/json"

func RegisterDefaultSignaling(sh *SignalingHandler) {

	sh.Register("chat", func(c *Client, msg Message) {
		var chat ChatMessage
		if err := json.Unmarshal(msg.Data, &chat); err != nil {
			return
		}
		chat.Username = c.Username
		msg.Data, _ = json.Marshal(chat)
		c.Room.Broadcast <- mustMarshal(msg)
	})

	// WebRTC offer
	sh.Register("offer", func(c *Client, msg Message) {
		c.Room.sendExcept(c, mustMarshal(msg))
	})

	// WebRTC answer
	sh.Register("answer", func(c *Client, msg Message) {
		c.Room.sendExcept(c, mustMarshal(msg))
	})

	// ICE candidate
	sh.Register("ice-candidate", func(c *Client, msg Message) {
		c.Room.sendExcept(c, mustMarshal(msg))
	})
}
