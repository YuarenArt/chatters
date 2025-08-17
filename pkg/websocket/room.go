package websocket

import (
	"encoding/json"
	"sync"
)

type ID uint32

type Room struct {
	ID         ID
	Clients    map[*Client]bool
	Register   chan *Client
	Unregister chan *Client
	Broadcast  chan []byte
	Stop       chan struct{}
	stopOnce   sync.Once
	mu         sync.RWMutex
}

func NewRoom(id ID) *Room {
	return &Room{
		ID:         id,
		Clients:    make(map[*Client]bool),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan []byte),
		Stop:       make(chan struct{}),
	}
}

func (r *Room) Run() {
	for {
		select {
		case client := <-r.Register:
			r.addClient(client)
		case client := <-r.Unregister:
			r.removeClient(client)
		case msg := <-r.Broadcast:
			r.sendMessage(msg)
		case <-r.Stop:
			return
		}
	}
}

func (r *Room) addClient(client *Client) {
	r.mu.Lock()
	r.Clients[client] = true
	r.mu.Unlock()
	r.broadcastJoinNotification(client)
}

func (r *Room) removeClient(client *Client) {
	r.mu.Lock()
	if _, ok := r.Clients[client]; ok {
		delete(r.Clients, client)
		close(client.Send)
	}
	r.mu.Unlock()
	r.broadcastLeaveNotification(client)
}

func (r *Room) sendMessage(msg []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for client := range r.Clients {
		select {
		case client.Send <- msg:
		default:
			close(client.Send)
			delete(r.Clients, client)
		}
	}
}

func (r *Room) broadcastJoinNotification(client *Client) {
	r.broadcastNotification("join", JoinNotification{
		Username:    client.Username,
		OnlineCount: r.GetClientCount(),
	})
}

func (r *Room) broadcastLeaveNotification(client *Client) {
	r.broadcastNotification("leave", LeaveNotification{
		Username:    client.Username,
		OnlineCount: r.GetClientCount(),
	})
}

func (r *Room) broadcastNotification(msgType string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := Message{Type: msgType, Data: data}
	msgBytes, _ := json.Marshal(msg)
	r.mu.RLock()
	for client := range r.Clients {
		select {
		case client.Send <- msgBytes:
		default:
		}
	}
	r.mu.RUnlock()
}

func (r *Room) StopRoom() {
	r.stopOnce.Do(func() {
		close(r.Stop)
		r.mu.Lock()
		defer r.mu.Unlock()
		for client := range r.Clients {
			close(client.Send)
			client.Conn.Close()
		}
	})
}

func (r *Room) GetClientCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.Clients)
}
