package repository

import "errors"

var ErrNodeKeyLocked = errors.New("this node profile is locked - unlock it before making changes")
