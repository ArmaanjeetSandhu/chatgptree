// ChatGPTree - Popup Script

// Initialize mermaid
mermaid.initialize({
  startOnLoad: true,
  theme: "neutral",
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: "cardinal",
  },
  securityLevel: "loose",
});

// Connect to the background script
const port = chrome.runtime.connect({ name: "popup" });

// Elements
const loadingEl = document.getElementById("loading");
const emptyStateEl = document.getElementById("emptyState");
const graphEl = document.getElementById("graph");
const refreshButton = document.getElementById("refreshButton");
const clearButton = document.getElementById("clearButton");

// Current tree data
let conversationTree = null;

// Initialize the popup
document.addEventListener("DOMContentLoaded", function () {
  // Set up event listeners
  refreshButton.addEventListener("click", refreshTree);
  clearButton.addEventListener("click", clearTree);

  // Get the initial tree data
  getConversationTree();

  // Listen for messages from the background script
  port.onMessage.addListener(handleMessage);
});

// Handle messages from the background script
function handleMessage(message) {
  console.log("Popup received message:", message);

  if (message.action === "getConversationTreeResponse") {
    if (message.success && message.tree) {
      conversationTree = message.tree;
      renderTree();
    } else {
      showEmptyState(
        "Error: " + (message.error || "Could not get conversation tree")
      );
    }
  } else if (message.action === "treeUpdated") {
    conversationTree = message.tree;
    renderTree();
  }
}

// Get the conversation tree from the content script
function getConversationTree() {
  showLoading();

  port.postMessage({
    action: "getConversationTree",
  });
}

// Refresh the tree data
function refreshTree() {
  getConversationTree();
}

// Clear the conversation tree
function clearTree() {
  if (
    confirm(
      "Are you sure you want to clear the conversation tree? This action cannot be undone."
    )
  ) {
    // Clear from local storage
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: () => {
            localStorage.removeItem("chatgpt-conversation-tree");
            // Reload the tracker
            if (window.conversationTracker) {
              window.conversationTracker.conversationTree = {
                rootId: null,
                nodes: {},
              };
              window.conversationTracker.saveTreeToStorage();
            }
          },
        });
      }
    });

    // Clear our local copy
    conversationTree = { rootId: null, nodes: {} };
    renderTree();
  }
}

// Render the tree visualization
function renderTree() {
  console.log("Rendering tree:", conversationTree);

  // Check if we have any data
  if (
    !conversationTree ||
    !conversationTree.rootId ||
    Object.keys(conversationTree.nodes).length === 0
  ) {
    showEmptyState();
    return;
  }

  // Show the graph container
  loadingEl.style.display = "none";
  emptyStateEl.style.display = "none";
  graphEl.style.display = "block";

  // Generate the Mermaid diagram syntax
  const mermaidCode = generateMermaidCode();

  // Create a container for the diagram
  graphEl.innerHTML = `<div class="mermaid">${mermaidCode}</div>`;

  // Render the diagram
  mermaid.init(undefined, ".mermaid");

  // Add click event listeners to the nodes
  setTimeout(() => {
    document.querySelectorAll(".node").forEach((node) => {
      node.addEventListener("click", handleNodeClick);
    });
  }, 100);
}

// Generate the Mermaid code for the flowchart
function generateMermaidCode() {
  // Start the flowchart
  let code = "graph TD;\n";

  // Add the nodes
  Object.values(conversationTree.nodes).forEach((node) => {
    const shortLabel = truncateText(node.label, 40);
    const tooltip = node.content.replace(/"/g, '\\"').replace(/\n/g, "\\n");

    // Add the node with styling based on author
    const nodeStyle =
      node.author === "User"
        ? "fill:#e5f2ff,stroke:#3b82f6,color:#1e40af"
        : "fill:#f0fdf4,stroke:#22c55e,color:#166534";

    code += `  ${node.id}["${shortLabel}" tooltip="${tooltip}" style="${nodeStyle}"];\n`;

    // Add the connections
    if (node.parentId) {
      code += `  ${node.parentId} --> ${node.id};\n`;
    }
  });

  return code;
}

// Handle node click
function handleNodeClick(event) {
  const nodeId = event.currentTarget.id;

  // Extract the message ID from the node ID (remove the mermaid prefix)
  const messageId = nodeId.replace("flowchart-", "");

  // Send a message to highlight this message in the chat
  port.postMessage({
    action: "highlightMessage",
    messageId: messageId,
  });
}

// Helper function to truncate text
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

// Show the loading state
function showLoading() {
  loadingEl.style.display = "flex";
  emptyStateEl.style.display = "none";
  graphEl.style.display = "none";
}

// Show the empty state
function showEmptyState(message) {
  loadingEl.style.display = "none";
  emptyStateEl.style.display = "flex";
  graphEl.style.display = "none";

  if (message) {
    document.querySelector(".empty-state-detail").textContent = message;
  } else {
    document.querySelector(".empty-state-detail").textContent =
      "Start or join a conversation in ChatGPT to see the tree visualization.";
  }
}
