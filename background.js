// ChatGPTree - Background Script
// Handles messaging between content script and popup

// Initialize connection tracking
let popupPorts = [];
let sidebarPorts = [];

// Listen for connections
chrome.runtime.onConnect.addListener((port) => {
  // Check which context is connecting
  if (port.name === "popup") {
    console.log("Popup connected");
    popupPorts.push(port);

    // Remove port when disconnected
    port.onDisconnect.addListener(() => {
      popupPorts = popupPorts.filter((p) => p !== port);
      console.log("Popup disconnected");
    });
  } else if (port.name === "sidebar") {
    console.log("Sidebar connected");
    sidebarPorts.push(port);

    // Remove port when disconnected
    port.onDisconnect.addListener(() => {
      sidebarPorts = sidebarPorts.filter((p) => p !== port);
      console.log("Sidebar disconnected");
    });
  }

  // Listen for messages on this port
  port.onMessage.addListener((message) => {
    handlePortMessage(message, port);
  });
});

// Listen for one-time messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  if (message.action === "treeUpdated") {
    // Forward the updated tree to any connected popups and sidebars
    popupPorts.forEach((port) => {
      port.postMessage({
        action: "treeUpdated",
        tree: message.tree,
      });
    });

    sidebarPorts.forEach((port) => {
      port.postMessage({
        action: "treeUpdated",
        tree: message.tree,
      });
    });
  }

  return true; // Keep the messaging channel open for async responses
});

// Handle messages from connected ports
function handlePortMessage(message, port) {
  console.log("Background received port message:", message);

  if (message.action === "getConversationTree") {
    // Forward request to the content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(
          tabs[0].id,
          { action: "getConversationTree" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Error sending message to content script:",
                chrome.runtime.lastError
              );
              port.postMessage({
                action: "getConversationTreeResponse",
                success: false,
                error: chrome.runtime.lastError.message,
              });
              return;
            }

            port.postMessage({
              action: "getConversationTreeResponse",
              success: true,
              tree: response.tree,
            });
          }
        );
      } else {
        port.postMessage({
          action: "getConversationTreeResponse",
          success: false,
          error: "No active tab found",
        });
      }
    });
  } else if (message.action === "highlightMessage") {
    // Forward highlight request to the content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "highlightMessage",
          messageId: message.messageId,
        });
      }
    });
  }
}
