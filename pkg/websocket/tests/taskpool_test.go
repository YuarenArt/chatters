package websocket_test

import (
	"sync"
	"testing"

	"github.com/YuarenArt/chatters/pkg/websocket"
	"github.com/stretchr/testify/suite"
)

type TaskPoolTestSuite struct {
	suite.Suite
	pool *websocket.TaskPool
}

func (s *TaskPoolTestSuite) SetupTest() {
	var err error
	s.pool, err = websocket.NewTaskPool(10)
	s.NoError(err)
}

func (s *TaskPoolTestSuite) TearDownTest() {
	s.pool.Release()
}

func (s *TaskPoolTestSuite) TestSubmitTask() {
	var wg sync.WaitGroup
	wg.Add(1)
	err := s.pool.Submit(func() {
		wg.Done()
	})
	s.NoError(err)
	wg.Wait()
}

func TestTaskPoolTestSuite(t *testing.T) {
	suite.Run(t, new(TaskPoolTestSuite))
}
