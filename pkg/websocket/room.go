package websocket

import (
	"encoding/json"
	"strconv"
	"sync"
)

type ID uint32

type MetricsNotifier interface {
	DroppedMessage(roomID string, clientID string)
}

// RoomOption represents a functional option for configuring a Room.
type RoomOption func(*Room)

type Room struct {
	Metrics        MetricsNotifier
	Clients        map[*Client]bool
	Register       chan *Client
	Unregister     chan *Client
	Broadcast      chan []byte
	Stop           chan struct{}
	HostID         string
	HashedPassword string
	mu             sync.RWMutex
	stopOnce       sync.Once
	ID             ID
}

func NewRoom(id ID, metrics MetricsNotifier, opts ...RoomOption) *Room {
	room := &Room{
		ID:         id,
		Clients:    make(map[*Client]bool, 50),
		Register:   make(chan *Client, 100),
		Unregister: make(chan *Client, 100),
		Broadcast:  make(chan []byte, 100),
		Stop:       make(chan struct{}, 1),
		Metrics:    metrics,
	}

	for _, opt := range opts {
		opt(room)
	}

	return room
}

// WithHost sets the HostID of the room.
func WithHost(hostID string) RoomOption {
	return func(r *Room) {
		r.HostID = hostID
	}
}

// WithPassword sets the hashed password of the room.
func WithPassword(hashedPassword string) RoomOption {
	return func(r *Room) {
		r.HashedPassword = hashedPassword
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
		client.closeOnce.Do(func() {
			close(client.Send)
		})
	}
	r.mu.Unlock()
	r.broadcastLeaveNotification(client)
}

func (r *Room) sendMessage(msg []byte) {
	var dropped []*Client

	r.mu.RLock()
	for client := range r.Clients {
		if client.isClosed() {
			dropped = append(dropped, client)
			continue
		}
		select {
		case client.Send <- msg:
		default:
			dropped = append(dropped, client)
		}
	}
	r.mu.RUnlock()

	if len(dropped) > 0 {
		r.mu.Lock()
		for _, client := range dropped {
			if _, ok := r.Clients[client]; ok {
				delete(r.Clients, client)
				client.closeOnce.Do(func() {
					close(client.Send)
				})
				if r.Metrics != nil {
					r.Metrics.DroppedMessage(strconv.Itoa(int(r.ID)), client.Username)
				}
			}
		}
		r.mu.Unlock()
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
	defer r.mu.RUnlock()
	for client := range r.Clients {
		select {
		case client.Send <- msgBytes:
		default:
		}
	}
}

func (r *Room) StopRoom() {
	r.stopOnce.Do(func() {
		close(r.Stop)
		r.mu.Lock()
		defer r.mu.Unlock()
		for client := range r.Clients {
			client.closeOnce.Do(func() {
				close(client.Send)
			})
			client.Conn.Close()
		}
		r.Clients = make(map[*Client]bool)
	})
}

func (r *Room) GetClientCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.Clients)
}

// HasPassword returns true if the room has a password set
func (r *Room) HasPassword() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.HashedPassword != ""
}

// GetHostID returns the host ID of the room
func (r *Room) GetHostID() string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.HostID
}

// SetPassword updates the room's hashed password
func (r *Room) SetPassword(hashedPassword string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.HashedPassword = hashedPassword
}

// KickClient removes a client from the room by username
func (r *Room) KickClient(username string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for client := range r.Clients {
		if client.Username == username {
			go func(c *Client) { r.Unregister <- c }(client)
			return true
		}
	}
	return false
}

func (r *Room) sendExcept(sender *Client, msg []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for client := range r.Clients {
		if client == sender {
			continue
		}
		select {
		case client.Send <- msg:
		default:
			client.closeOnce.Do(func() {
				close(client.Send)
			})
			delete(r.Clients, client)
		}
	}
}
