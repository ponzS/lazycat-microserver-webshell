const overlapLength = (startA, endA, startB, endB) => (
  Math.max(0, Math.min(endA, endB) - Math.max(startA, startB))
);

export const splitLayout = (node, targetPaneId, direction, newPaneId) => {
  if (!node) {
    return false;
  }
  if (node.type === "leaf" && node.paneId === targetPaneId) {
    const outerSize = node.size;
    node.type = "split";
    node.direction = direction;
    node.children = [
      { type: "leaf", paneId: targetPaneId, size: 50 },
      { type: "leaf", paneId: newPaneId, size: 50 },
    ];
    delete node.paneId;
    if (outerSize) {
      node.size = outerSize;
    } else {
      delete node.size;
    }
    return true;
  }
  if (node.type === "split") {
    return node.children.some((child) => splitLayout(child, targetPaneId, direction, newPaneId));
  }
  return false;
};

export const removePaneFromLayout = (node, paneId) => {
  if (!node) {
    return null;
  }
  if (node.type === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  if (node.type !== "split") {
    return node;
  }
  const children = node.children.map((child) => removePaneFromLayout(child, paneId)).filter(Boolean);
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  const share = 100 / children.length;
  for (const child of children) {
    if (!child.size) {
      child.size = share;
    }
  }
  node.children = children;
  return node;
};

export const collectPaneIds = (node, result = []) => {
  if (!node) {
    return result;
  }
  if (node.type === "leaf") {
    result.push(node.paneId);
    return result;
  }
  for (const child of node.children || []) {
    collectPaneIds(child, result);
  }
  return result;
};

const paneRectSnapshot = (tab) => Array.from(tab?.panes?.values() || [])
  .map((pane) => {
    const rect = pane.shellEl?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      id: pane.id,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    };
  })
  .filter(Boolean);

const comparePaneMetric = (left, right) => {
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  if (left.rank !== right.rank) {
    return left.rank - right.rank;
  }
  if (left.primary !== right.primary) {
    return right.primary - left.primary;
  }
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  if (left.secondary !== right.secondary) {
    return left.secondary - right.secondary;
  }
  return left.index - right.index;
};

const buildHorizontalPaneMetric = (currentRect, candidateRect, left, index) => {
  const overlap = overlapLength(currentRect.top, currentRect.bottom, candidateRect.top, candidateRect.bottom);
  if (overlap <= 0) {
    return null;
  }
  const distance = left ? currentRect.left - candidateRect.right : candidateRect.left - currentRect.right;
  if (distance < -6) {
    return null;
  }
  const sameEdge = Math.abs(candidateRect.top - currentRect.top) <= 6;
  const containsCurrent = candidateRect.top <= currentRect.top + 6 && candidateRect.bottom >= currentRect.bottom - 6;
  return {
    rank: sameEdge ? 0 : containsCurrent ? 1 : 2,
    primary: overlap,
    distance: Math.max(0, distance),
    secondary: Math.abs(candidateRect.top - currentRect.top),
    index,
  };
};

const buildVerticalPaneMetric = (currentRect, candidateRect, up, index) => {
  const overlap = overlapLength(currentRect.left, currentRect.right, candidateRect.left, candidateRect.right);
  if (overlap <= 0) {
    return null;
  }
  const distance = up ? currentRect.top - candidateRect.bottom : candidateRect.top - currentRect.bottom;
  if (distance < -6) {
    return null;
  }
  const sameEdge = Math.abs(candidateRect.left - currentRect.left) <= 6;
  const containsCurrent = candidateRect.left <= currentRect.left + 6 && candidateRect.right >= currentRect.right - 6;
  return {
    rank: sameEdge ? 0 : containsCurrent ? 1 : 2,
    primary: overlap,
    distance: Math.max(0, distance),
    secondary: Math.abs(candidateRect.left - currentRect.left),
    index,
  };
};

export function createWorkspaceLayoutController({
  getCurrentTab = () => null,
  setActivePane = () => {},
} = {}) {
  let disposed = false;

  const selectPaneInDirection = (direction) => {
    if (disposed) {
      return false;
    }
    const tab = getCurrentTab?.();
    const activePane = tab?.panes?.get?.(tab.activePaneId);
    if (!tab || !activePane) {
      return false;
    }
    const rects = paneRectSnapshot(tab);
    const currentRect = rects.find((rect) => rect.id === activePane.id);
    if (!currentRect) {
      return false;
    }
    let bestRect = null;
    let bestMetric = null;
    rects.forEach((candidateRect, index) => {
      if (candidateRect.id === activePane.id) {
        return;
      }
      let metric = null;
      if (direction === "left") {
        metric = buildHorizontalPaneMetric(currentRect, candidateRect, true, index);
      } else if (direction === "right") {
        metric = buildHorizontalPaneMetric(currentRect, candidateRect, false, index);
      } else if (direction === "up") {
        metric = buildVerticalPaneMetric(currentRect, candidateRect, true, index);
      } else if (direction === "down") {
        metric = buildVerticalPaneMetric(currentRect, candidateRect, false, index);
      }
      if (metric && comparePaneMetric(metric, bestMetric) < 0) {
        bestMetric = metric;
        bestRect = candidateRect;
      }
    });
    if (!bestRect?.id) {
      return false;
    }
    setActivePane(tab, bestRect.id);
    return true;
  };

  const dispose = () => {
    if (disposed) {
      return false;
    }
    disposed = true;
    return true;
  };

  return Object.freeze({
    collectPaneIds,
    dispose,
    isDisposed: () => disposed,
    removePaneFromLayout,
    selectPaneInDirection,
    splitLayout,
  });
}
