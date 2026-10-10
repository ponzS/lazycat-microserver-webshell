package core

func (w *terminalWorkspace) detachExecutionPanes() {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, p := range w.panes {
		p.mu.Lock()
		p.closing = true
		for c := range p.clients {
			c.close()
		}
		p.checkpoint.close()
		p.mu.Unlock()
		if p.execution != nil {
			p.execution.Detach()
		}
	}
}
