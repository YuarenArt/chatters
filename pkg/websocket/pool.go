package websocket

import "github.com/panjf2000/ants"

type TaskPool struct {
	pool *ants.Pool
}

func NewTaskPool(size int) (*TaskPool, error) {
	p, err := ants.NewPool(size)
	if err != nil {
		return nil, err
	}
	return &TaskPool{pool: p}, nil
}

func (tp *TaskPool) Submit(task func()) error {
	return tp.pool.Submit(task)
}

func (tp *TaskPool) Release() {
	tp.pool.Release()
}
