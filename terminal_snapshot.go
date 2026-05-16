package main

import (
	"hash/fnv"
	"image/color"
	"slices"
	"strconv"
	"sync"

	uv "github.com/charmbracelet/ultraviolet"
	vt "github.com/unixshells/vt-go"
)

const structuredScrollbackLines = 5000

type terminalStructuredState struct {
	mu              sync.Mutex
	seq             uint64
	emu             *vt.Emulator
	scrollbackKnown bool
	scrollbackSigs  []uint64
}

type terminalSnapshotMessage struct {
	Type       string           `json:"type"`
	Selector   string           `json:"selector,omitempty"`
	PaneID     string           `json:"pane_id,omitempty"`
	Seq        uint64           `json:"seq"`
	Cols       int              `json:"cols"`
	Rows       int              `json:"rows"`
	AltScreen  bool             `json:"alt_screen"`
	Scrollback []structuredLine `json:"scrollback,omitempty"`
	Screen     []structuredLine `json:"screen"`
	Cursor     structuredCursor `json:"cursor"`
}

type terminalFrameMessage struct {
	Type       string                      `json:"type"`
	Selector   string                      `json:"selector,omitempty"`
	PaneID     string                      `json:"pane_id,omitempty"`
	Seq        uint64                      `json:"seq"`
	Cols       int                         `json:"cols"`
	Rows       int                         `json:"rows"`
	AltScreen  bool                        `json:"alt_screen"`
	RowsData   []structuredRow             `json:"rows_data"`
	Scrollback *structuredScrollbackUpdate `json:"scrollback_update,omitempty"`
	Cursor     structuredCursor            `json:"cursor"`
}

type structuredScrollbackUpdate struct {
	Len    int              `json:"len"`
	Reset  bool             `json:"reset,omitempty"`
	Drop   int              `json:"drop,omitempty"`
	Append []structuredLine `json:"append,omitempty"`
	Lines  []structuredLine `json:"lines,omitempty"`
}

type structuredCursor struct {
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Visible bool `json:"visible"`
}

type structuredRow struct {
	Y    int            `json:"y"`
	Line structuredLine `json:"line"`
}

type structuredLine struct {
	Text  string           `json:"text,omitempty"`
	Cells []structuredCell `json:"cells,omitempty"`
}

type structuredCell struct {
	Text      string           `json:"text,omitempty"`
	Width     *int             `json:"width,omitempty"`
	Fg        string           `json:"fg,omitempty"`
	Bg        string           `json:"bg,omitempty"`
	Underline string           `json:"underline,omitempty"`
	Attrs     *structuredAttrs `json:"attrs,omitempty"`
	Link      string           `json:"link,omitempty"`
}

type structuredAttrs struct {
	Bold          bool `json:"bold,omitempty"`
	Faint         bool `json:"faint,omitempty"`
	Italic        bool `json:"italic,omitempty"`
	Blink         bool `json:"blink,omitempty"`
	Reverse       bool `json:"reverse,omitempty"`
	Conceal       bool `json:"conceal,omitempty"`
	Strikethrough bool `json:"strikethrough,omitempty"`
}

func newTerminalStructuredState(cols, rows int) *terminalStructuredState {
	emu := vt.NewEmulator(normalizeCols(cols), normalizeRows(rows))
	emu.SetScrollbackSize(structuredScrollbackLines)
	return &terminalStructuredState{emu: emu}
}

func (s *terminalStructuredState) write(data []byte) terminalFrameMessage {
	if s == nil || len(data) == 0 {
		return terminalFrameMessage{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	beforeSigs := append([]uint64(nil), s.scrollbackSigs...)
	beforeKnown := s.scrollbackKnown
	_, _ = s.emu.Write(data)
	s.seq++
	return s.frameLocked(nil, beforeSigs, beforeKnown)
}

func (s *terminalStructuredState) resize(cols, rows int) terminalFrameMessage {
	if s == nil {
		return terminalFrameMessage{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	beforeSigs := append([]uint64(nil), s.scrollbackSigs...)
	beforeKnown := s.scrollbackKnown
	s.emu.Resize(normalizeCols(cols), normalizeRows(rows))
	s.seq++
	return s.frameLocked(nil, beforeSigs, beforeKnown)
}

func (s *terminalStructuredState) snapshot(selector, paneID string) terminalSnapshotMessage {
	if s == nil {
		return terminalSnapshotMessage{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cols := s.emu.Width()
	rows := s.emu.Height()
	scrollback := make([]structuredLine, 0, s.emu.ScrollbackLen())
	for y := 0; y < s.emu.ScrollbackLen(); y++ {
		scrollback = append(scrollback, s.scrollbackLineLocked(y, cols))
	}
	s.scrollbackSigs = s.scrollbackSignaturesLocked()
	s.scrollbackKnown = true
	screen := make([]structuredLine, 0, rows)
	for y := 0; y < rows; y++ {
		screen = append(screen, s.screenLineLocked(y, cols))
	}
	msg := terminalSnapshotMessage{
		Type:       "terminal-snapshot",
		Selector:   selector,
		PaneID:     paneID,
		Seq:        s.seq,
		Cols:       cols,
		Rows:       rows,
		AltScreen:  s.emu.IsAltScreen(),
		Scrollback: scrollback,
		Screen:     screen,
		Cursor:     s.cursorLocked(),
	}
	return msg
}

func (s *terminalStructuredState) frameLocked(touched []int, beforeSigs []uint64, beforeKnown bool) terminalFrameMessage {
	cols := s.emu.Width()
	rows := s.emu.Height()
	if len(touched) == 0 {
		touched = make([]int, rows)
		for y := 0; y < rows; y++ {
			touched[y] = y
		}
	}
	rowsData := make([]structuredRow, 0, len(touched))
	seen := make(map[int]struct{}, len(touched))
	for _, y := range touched {
		if y < 0 || y >= rows {
			continue
		}
		if _, ok := seen[y]; ok {
			continue
		}
		seen[y] = struct{}{}
		rowsData = append(rowsData, structuredRow{Y: y, Line: s.screenLineLocked(y, cols)})
	}
	return terminalFrameMessage{
		Type:       "terminal-frame",
		Seq:        s.seq,
		Cols:       cols,
		Rows:       rows,
		AltScreen:  s.emu.IsAltScreen(),
		RowsData:   rowsData,
		Scrollback: s.scrollbackUpdateLocked(beforeSigs, beforeKnown),
		Cursor:     s.cursorLocked(),
	}
}

func (s *terminalStructuredState) cursorLocked() structuredCursor {
	pos := s.emu.CursorPosition()
	return structuredCursor{X: pos.X, Y: pos.Y, Visible: true}
}

func (s *terminalStructuredState) screenLineLocked(y, width int) structuredLine {
	cells := make([]structuredCell, width)
	for x := 0; x < width; x++ {
		cells[x] = structuredCellFromUV(s.emu.CellAt(x, y))
	}
	return structuredLineFromCells(cells)
}

func (s *terminalStructuredState) scrollbackLineLocked(y, width int) structuredLine {
	cells := make([]structuredCell, width)
	for x := 0; x < width; x++ {
		cells[x] = structuredCellFromUV(s.emu.ScrollbackCellAt(x, y))
	}
	return structuredLineFromCells(cells)
}

func (s *terminalStructuredState) scrollbackUpdateLocked(beforeSigs []uint64, beforeKnown bool) *structuredScrollbackUpdate {
	nextSigs := s.scrollbackSignaturesLocked()
	if slices.Equal(beforeSigs, nextSigs) {
		return nil
	}
	cols := s.emu.Width()
	nextLines := make([]structuredLine, 0, len(nextSigs))
	for y := 0; y < len(nextSigs); y++ {
		nextLines = append(nextLines, s.scrollbackLineLocked(y, cols))
	}
	s.scrollbackSigs = nextSigs
	s.scrollbackKnown = true

	update := &structuredScrollbackUpdate{Len: len(nextLines)}
	if !beforeKnown || len(nextSigs) < len(beforeSigs) {
		update.Reset = true
		update.Lines = nextLines
		return update
	}
	if len(nextSigs) > len(beforeSigs) && slices.Equal(beforeSigs, nextSigs[:len(beforeSigs)]) {
		update.Append = append([]structuredLine(nil), nextLines[len(beforeSigs):]...)
		return update
	}
	drop := scrollbackDroppedPrefix(beforeSigs, nextSigs)
	if drop > 0 {
		update.Drop = drop
		update.Append = append([]structuredLine(nil), nextLines[len(nextLines)-drop:]...)
		return update
	}
	update.Reset = true
	update.Lines = nextLines
	return update
}

func (s *terminalStructuredState) scrollbackSignaturesLocked() []uint64 {
	cols := s.emu.Width()
	sigs := make([]uint64, s.emu.ScrollbackLen())
	for y := 0; y < len(sigs); y++ {
		sigs[y] = s.scrollbackLineSignatureLocked(y, cols)
	}
	return sigs
}

func (s *terminalStructuredState) scrollbackLineSignatureLocked(y, width int) uint64 {
	hash := fnv.New64a()
	for x := 0; x < width; x++ {
		cell := structuredCellFromUV(s.emu.ScrollbackCellAt(x, y))
		writeStructuredCellSignature(hash, cell)
	}
	return hash.Sum64()
}

func scrollbackDroppedPrefix(before, after []uint64) int {
	maxDrop := min(len(before), len(after))
	for drop := 1; drop <= maxDrop; drop++ {
		if slices.Equal(before[drop:], after[:len(before)-drop]) {
			return drop
		}
	}
	return 0
}

func structuredLineFromCells(cells []structuredCell) structuredLine {
	cells = trimStructuredCells(cells)
	if len(cells) == 0 {
		return structuredLine{}
	}
	if text, ok := structuredPlainText(cells); ok {
		return structuredLine{Text: text}
	}
	return structuredLine{Cells: cells}
}

func trimStructuredCells(cells []structuredCell) []structuredCell {
	end := len(cells)
	for end > 0 && cells[end-1].isBlank() {
		end--
	}
	if end == 0 {
		return nil
	}
	return cells[:end]
}

func structuredCellFromUV(cell *uv.Cell) structuredCell {
	if cell == nil || cell.IsZero() {
		return structuredCell{Text: " "}
	}
	text := cell.Content
	if text == "" {
		text = " "
	}
	width := cell.Width
	next := structuredCell{
		Text: text,
	}
	if width != 1 {
		next.Width = intPtr(width)
	}
	if fg := colorToHex(cell.Style.Fg); fg != "" {
		next.Fg = fg
	}
	if bg := colorToHex(cell.Style.Bg); bg != "" {
		next.Bg = bg
	}
	if underline := underlineName(cell.Style.Underline); underline != "" {
		next.Underline = underline
	}
	if attrs := structuredAttrsFromUV(cell.Style.Attrs); !attrs.isZero() {
		next.Attrs = &attrs
	}
	if !cell.Link.IsZero() {
		next.Link = cell.Link.URL
	}
	return next
}

func (c structuredCell) isBlank() bool {
	width := 1
	if c.Width != nil {
		width = *c.Width
	}
	return (c.Text == "" || c.Text == " ") &&
		width == 1 &&
		c.Fg == "" &&
		c.Bg == "" &&
		c.Underline == "" &&
		c.Attrs == nil &&
		c.Link == ""
}

func structuredPlainText(cells []structuredCell) (string, bool) {
	var text string
	for _, cell := range cells {
		if cell.Width != nil && *cell.Width != 1 {
			return "", false
		}
		if cell.Fg != "" || cell.Bg != "" || cell.Underline != "" || cell.Attrs != nil || cell.Link != "" {
			return "", false
		}
		if cell.Text == "" {
			text += " "
		} else {
			text += cell.Text
		}
	}
	return text, true
}

func structuredAttrsFromUV(attrs uint8) structuredAttrs {
	return structuredAttrs{
		Bold:          attrs&uv.AttrBold != 0,
		Faint:         attrs&uv.AttrFaint != 0,
		Italic:        attrs&uv.AttrItalic != 0,
		Blink:         attrs&uv.AttrBlink != 0 || attrs&uv.AttrRapidBlink != 0,
		Reverse:       attrs&uv.AttrReverse != 0,
		Conceal:       attrs&uv.AttrConceal != 0,
		Strikethrough: attrs&uv.AttrStrikethrough != 0,
	}
}

func (a structuredAttrs) isZero() bool {
	return !a.Bold &&
		!a.Faint &&
		!a.Italic &&
		!a.Blink &&
		!a.Reverse &&
		!a.Conceal &&
		!a.Strikethrough
}

func intPtr(value int) *int {
	return &value
}

type structuredSignatureWriter interface {
	Write([]byte) (int, error)
}

func writeStructuredCellSignature(hash structuredSignatureWriter, cell structuredCell) {
	writeStructuredSignatureString(hash, cell.Text)
	_, _ = hash.Write([]byte{0})
	if cell.Width != nil {
		writeStructuredSignatureString(hash, "w")
		writeStructuredSignatureString(hash, strconv.Itoa(*cell.Width))
	}
	writeStructuredSignatureString(hash, cell.Fg)
	_, _ = hash.Write([]byte{0})
	writeStructuredSignatureString(hash, cell.Bg)
	_, _ = hash.Write([]byte{0})
	writeStructuredSignatureString(hash, cell.Underline)
	_, _ = hash.Write([]byte{0})
	writeStructuredSignatureString(hash, cell.Link)
	_, _ = hash.Write([]byte{0})
	if cell.Attrs != nil {
		if cell.Attrs.Bold {
			writeStructuredSignatureString(hash, "b")
		}
		if cell.Attrs.Faint {
			writeStructuredSignatureString(hash, "f")
		}
		if cell.Attrs.Italic {
			writeStructuredSignatureString(hash, "i")
		}
		if cell.Attrs.Blink {
			writeStructuredSignatureString(hash, "k")
		}
		if cell.Attrs.Reverse {
			writeStructuredSignatureString(hash, "r")
		}
		if cell.Attrs.Conceal {
			writeStructuredSignatureString(hash, "c")
		}
		if cell.Attrs.Strikethrough {
			writeStructuredSignatureString(hash, "s")
		}
	}
	_, _ = hash.Write([]byte{0xff})
}

func writeStructuredSignatureString(hash structuredSignatureWriter, value string) {
	_, _ = hash.Write([]byte(value))
}

func underlineName(underline uv.Underline) string {
	switch underline {
	case uv.UnderlineSingle:
		return "single"
	case uv.UnderlineDouble:
		return "double"
	case uv.UnderlineCurly:
		return "curly"
	case uv.UnderlineDotted:
		return "dotted"
	case uv.UnderlineDashed:
		return "dashed"
	default:
		return ""
	}
}

func colorToHex(c color.Color) string {
	if c == nil {
		return ""
	}
	r, g, b, a := c.RGBA()
	if a == 0 {
		return ""
	}
	return "#" + hexByte(byte(r>>8)) + hexByte(byte(g>>8)) + hexByte(byte(b>>8))
}

const hexDigits = "0123456789ABCDEF"

func hexByte(value byte) string {
	return string([]byte{hexDigits[value>>4], hexDigits[value&0x0f]})
}
