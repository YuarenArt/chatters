package websocket_test

import (
	"testing"

	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/stretchr/testify/suite"
)

type HubTestSuite struct {
	suite.Suite
	hub *websocket.Hub
}

func (s *HubTestSuite) SetupTest() {
	s.hub = websocket.NewHub()
}

func (s *HubTestSuite) TestCreateRoom() {
	room, created := s.hub.CreateRoom(1, nil)
	s.True(created)
	s.NotNil(room)
	s.Equal(websocket.ID(1), room.ID)

	_, exists := s.hub.GetRoom(1)
	s.True(exists)
}

func (s *HubTestSuite) TestGetNonExistentRoom() {
	_, exists := s.hub.GetRoom(999)
	s.False(exists)
}

func (s *HubTestSuite) TestDeleteRoom() {
	s.hub.CreateRoom(1, nil)
	s.True(s.hub.DeleteRoom(1))
	_, exists := s.hub.GetRoom(1)
	s.False(exists)
}

func TestHubTestSuite(t *testing.T) {
	suite.Run(t, new(HubTestSuite))
}
