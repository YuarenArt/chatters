package websocket

import (
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
			r.mu.Lock()
			r.Clients[client] = true
			r.mu.Unlock()
		case client := <-r.Unregister:
			r.mu.Lock()
			if _, ok := r.Clients[client]; ok {
				delete(r.Clients, client)
				close(client.Send)
			}
			r.mu.Unlock()
		case msg := <-r.Broadcast:
			r.mu.RLock()
			for client := range r.Clients {
				select {
				case client.Send <- msg:
				default:
					close(client.Send)
					delete(r.Clients, client)
				}
			}
			r.mu.RUnlock()
		case <-r.Stop:
			return
		}
	}
}

// StopRoom safely stops the room using sync.Once to prevent multiple calls
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

// GetClientCount returns the number of clients in the room
func (r *Room) GetClientCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.Clients)
}
