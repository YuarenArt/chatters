package websocket

import "sync"

type Hub struct {
	Rooms *sync.Map // Rooms map[ID]*Room
}

func NewHub() *Hub {
	return &Hub{
		Rooms: &sync.Map{},
	}
}

func (h *Hub) GetRoom(id ID) (*Room, bool) {
	room, ok := h.Rooms.Load(id)
	if !ok {
		return nil, false
	}
	return room.(*Room), true
}

func (h *Hub) CreateRoom(id ID, metrics MetricsNotifier) (*Room, bool) {
	room := NewRoom(id, metrics)
	_, loaded := h.Rooms.LoadOrStore(id, room)
	if loaded {
		return nil, false
	}
	go room.Run()
	return room, true
}

func (h *Hub) DeleteRoom(id ID) bool {
	_, existed := h.Rooms.LoadAndDelete(id)
	return existed
}
