// ChatGPTree - Content Script
// This script is injected into the ChatGPT web app to track conversation history

class ConversationTracker {
  constructor() {
    this.conversationTree = {
      rootId: null,
      nodes: {},
    };
    this.currentBranchId = null;
    this.lastMessageId = null;
    this.observer = null;
    this.messageIdCounter = 0;
    this.editObservers = new Map(); // Track edit buttons for each message
    this.mutationQueue = [];
    this.processingMutations = false;
    this.maxMessages = 1000; // Maximum number of messages to store

    // Load existing tree from storage
    this.loadTreeFromStorage();

    // Initialize the observer
    this.initObserver();

    // Create and inject the sidebar button
    this.injectSidebarToggle();

    // Setup communication with popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "getConversationTree") {
        sendResponse({ tree: this.conversationTree });
      } else if (request.action === "highlightMessage") {
        this.highlightMessage(request.messageId);
        sendResponse({ success: true });
      } else if (request.action === "clearConversationTree") {
        this.clearConversationTree();
        sendResponse({ success: true });
      }
    });
  }

  generateId() {
    return `msg_${Date.now()}_${this.messageIdCounter++}`;
  }

  initObserver() {
    // Target the main chat container
    const targetNode = document.querySelector("main");
    if (!targetNode) {
      console.log("Target node not found, retrying in 1 second...");
      setTimeout(() => this.initObserver(), 1000);
      return;
    }

    // Create a MutationObserver to watch for changes
    this.observer = new MutationObserver((mutations) => {
      // Add mutations to the queue
      this.mutationQueue.push(...mutations);

      // Process the queue with throttling if not already processing
      if (!this.processingMutations) {
        this.processMutationQueue();
      }
    });

    // Start observing
    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log("ConversationTracker observer initialized");

    // Initial scan of the page for existing messages
    this.scanExistingMessages();
  }

  processMutationQueue() {
    // Set flag to prevent multiple processing
    this.processingMutations = true;

    // Process batches of mutations with throttling
    setTimeout(() => {
      // Get current batch of mutations
      const currentBatch = this.mutationQueue.splice(
        0,
        this.mutationQueue.length
      );

      if (currentBatch.length > 0) {
        this.processMutations(currentBatch);
      }

      // Check if there are more mutations to process
      if (this.mutationQueue.length > 0) {
        // Continue processing with throttling
        this.processMutationQueue();
      } else {
        // Reset flag when queue is empty
        this.processingMutations = false;
      }
    }, 300); // 300ms throttle as required
  }

  scanExistingMessages() {
    // Find all existing messages using the specific selector
    const messageElements = document.querySelectorAll(
      'article[data-testid^="conversation-turn"]'
    );

    if (messageElements.length === 0) {
      console.log("No existing messages found");
      return;
    }

    console.log(`Found ${messageElements.length} existing messages`);

    // Process each message
    let previousId = null;
    messageElements.forEach((element) => {
      // Determine if this is a user or assistant message based on the updated selectors
      const userContentElement = element.querySelector(
        "div.whitespace-pre-wrap"
      );
      const assistantContentElement = element.querySelector("div.markdown");

      // Determine the message type and get the content element
      const isUserMessage = userContentElement !== null;
      const contentElement = isUserMessage
        ? userContentElement
        : assistantContentElement;

      if (!contentElement) {
        console.log("Could not find content element for message", element);
        return;
      }

      // Extract message content using innerText for better text representation
      const content = contentElement.innerText.trim();

      // Generate an ID for this message
      const messageId = this.generateId();

      // Add to the tree
      this.addMessageToTree({
        id: messageId,
        content: content,
        timestamp: new Date().toISOString(),
        author: isUserMessage ? "User" : "Assistant",
        parentId: previousId,
      });

      // Mark this element with our generated ID for future reference
      element.dataset.ourMessageId = messageId;

      // Observe edit buttons for this message
      this.observeMessageForEdits(element, messageId);

      // Update previous ID for the next message
      previousId = messageId;
    });

    // Set the last message ID
    this.lastMessageId = previousId;

    // Save the updated tree
    this.saveTreeToStorage();
  }

  processMutations(mutations) {
    let newContentDetected = false;

    mutations.forEach((mutation) => {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a new message using the updated selector
            if (
              node.matches('article[data-testid^="conversation-turn"]') ||
              node.querySelector('article[data-testid^="conversation-turn"]')
            ) {
              const messageElement = node.matches(
                'article[data-testid^="conversation-turn"]'
              )
                ? node
                : node.querySelector(
                    'article[data-testid^="conversation-turn"]'
                  );

              if (messageElement && !messageElement.dataset.ourMessageId) {
                this.processNewMessage(messageElement);
                newContentDetected = true;
              }
            }

            // Also scan for edit buttons
            const messageElements = node.querySelectorAll(
              'article[data-testid^="conversation-turn"]'
            );
            messageElements.forEach((msgElem) => {
              if (msgElem.dataset.ourMessageId) {
                this.observeMessageForEdits(
                  msgElem,
                  msgElem.dataset.ourMessageId
                );
              }
            });
          }
        }
      }
    });

    if (newContentDetected) {
      this.saveTreeToStorage();
    }
  }

  processNewMessage(messageElement) {
    // Check if this is an article element with the expected data-testid
    if (!messageElement.matches('article[data-testid^="conversation-turn"]')) {
      // If not a conversation turn, try to find one within this element
      const conversationTurn = messageElement.querySelector(
        'article[data-testid^="conversation-turn"]'
      );
      if (conversationTurn) {
        messageElement = conversationTurn;
      } else {
        console.log(
          "Element is not a valid conversation turn:",
          messageElement
        );
        return;
      }
    }

    // Determine if this is a user or assistant message based on the updated selectors
    const userContentElement = messageElement.querySelector(
      "div.whitespace-pre-wrap"
    );
    const assistantContentElement =
      messageElement.querySelector("div.markdown");

    // Determine the message type and get the content element
    const isUserMessage = userContentElement !== null;
    const contentElement = isUserMessage
      ? userContentElement
      : assistantContentElement;

    if (!contentElement) {
      console.log(
        "Could not find content element for new message",
        messageElement
      );
      return;
    }

    // Extract message content using innerText for better text representation
    const content = contentElement.innerText.trim();

    // Generate an ID for this message
    const messageId = this.generateId();

    // Add to the tree
    this.addMessageToTree({
      id: messageId,
      content: content,
      timestamp: new Date().toISOString(),
      author: isUserMessage ? "User" : "Assistant",
      parentId: this.lastMessageId,
    });

    // Mark this element with our generated ID for future reference
    messageElement.dataset.ourMessageId = messageId;

    // Update the last message ID
    this.lastMessageId = messageId;

    // Observe edit buttons for this message
    this.observeMessageForEdits(messageElement, messageId);

    console.log(
      `Added new ${isUserMessage ? "user" : "assistant"} message to tree:`,
      content.substring(0, 50) + "..."
    );
  }

  observeMessageForEdits(messageElement, messageId) {
    // Look for edit buttons within this message
    const editButton = messageElement.querySelector(
      '[data-testid="edit-button"], button:has(svg[data-icon="pencil"])'
    );

    if (editButton && !this.editObservers.has(messageId)) {
      // Create a click listener for the edit button
      const clickListener = () => {
        console.log(`Edit button clicked for message: ${messageId}`);
        this.handleMessageEdit(messageId, messageElement);
      };

      // Add the listener
      editButton.addEventListener("click", clickListener);

      // Store the listener so we can remove it later if needed
      this.editObservers.set(messageId, clickListener);

      console.log(`Added edit observer for message: ${messageId}`);
    }
  }

  handleMessageEdit(messageId, messageElement) {
    console.log(`Handling edit for message: ${messageId}`);

    // We need to wait for the edit to be submitted
    // Watch for the submit button to be clicked
    const checkForSubmit = () => {
      const submitButton = document.querySelector(
        'button[data-testid="send-button"], button.absolute.p-1.rounded-md'
      );

      if (submitButton) {
        const submitListener = () => {
          console.log("Edit submitted");

          // Wait for the content to be updated
          setTimeout(() => {
            this.forkConversationFromEdit(messageId, messageElement);
          }, 1000);
        };

        submitButton.addEventListener("click", submitListener, { once: true });
      } else {
        setTimeout(checkForSubmit, 500);
      }
    };

    checkForSubmit();
  }

  forkConversationFromEdit(messageId, messageElement) {
    console.log(`Forking conversation from edit at message: ${messageId}`);

    // Find the original node in our tree
    const originalNode = this.conversationTree.nodes[messageId];
    if (!originalNode) {
      console.log(`Original node not found for ID: ${messageId}`);
      return;
    }

    // Get the updated content using the appropriate selector based on original author
    let contentElement = null;
    if (originalNode.author === "User") {
      contentElement = messageElement.querySelector("div.whitespace-pre-wrap");
    } else {
      contentElement = messageElement.querySelector("div.markdown");
    }

    if (!contentElement) {
      console.log(
        "Could not find content element for edited message",
        messageElement
      );
      return;
    }

    const updatedContent = contentElement.innerText.trim();

    // Create a new node with the updated content
    const newNodeId = this.generateId();

    // Add the new node to the tree
    this.addMessageToTree({
      id: newNodeId,
      content: updatedContent,
      timestamp: new Date().toISOString(),
      author: originalNode.author,
      parentId: originalNode.parentId,
      isForkedFrom: messageId,
    });

    // Update the element's ID reference
    messageElement.dataset.ourMessageId = newNodeId;

    // Set this as the current branch
    this.lastMessageId = newNodeId;

    // Update any edit observers
    if (this.editObservers.has(messageId)) {
      const listener = this.editObservers.get(messageId);
      const editButton = messageElement.querySelector(
        '[data-testid="edit-button"], button:has(svg[data-icon="pencil"])'
      );
      if (editButton) {
        editButton.removeEventListener("click", listener);
      }
      this.editObservers.delete(messageId);
    }

    // Add a new edit observer for this message
    this.observeMessageForEdits(messageElement, newNodeId);

    // Save the updated tree
    this.saveTreeToStorage();

    console.log(`Conversation forked. New branch head: ${newNodeId}`);
  }

  addMessageToTree(message) {
    // If this is the first message, set it as the root
    if (!this.conversationTree.rootId) {
      this.conversationTree.rootId = message.id;
    }

    // Get the first 8-10 words for the label (keeping the requirement from the original spec)
    const words = message.content.split(" ");
    const wordCount = Math.min(words.length, 10); // Take up to 10 words
    const shortText = words.slice(0, wordCount).join(" ");
    const labelSuffix = words.length > wordCount ? "..." : "";

    // Add the node to our tree
    this.conversationTree.nodes[message.id] = {
      id: message.id,
      content: message.content,
      timestamp: message.timestamp,
      author: message.author,
      parentId: message.parentId,
      childIds: [],
      isForkedFrom: message.isForkedFrom || null,
      // Label with "User:" or "Assistant:" prefix as specified
      label: `${message.author}: ${shortText}${labelSuffix}`,
    };

    // Update the parent's children array
    if (message.parentId && this.conversationTree.nodes[message.parentId]) {
      this.conversationTree.nodes[message.parentId].childIds.push(message.id);
    }

    // Check if we need to prune the tree
    this.pruneTreeIfNeeded();
  }

  pruneTreeIfNeeded() {
    const nodeCount = Object.keys(this.conversationTree.nodes).length;

    // Check if we need to prune
    if (nodeCount > this.maxMessages) {
      console.log(
        `Tree exceeded ${this.maxMessages} messages (${nodeCount}), pruning oldest branches...`
      );

      // Find leaf nodes (nodes with no children)
      const leafNodes = this.findLeafNodes();

      // Sort leaf nodes by timestamp (oldest first)
      leafNodes.sort((a, b) => {
        const timestampA = new Date(
          this.conversationTree.nodes[a].timestamp
        ).getTime();
        const timestampB = new Date(
          this.conversationTree.nodes[b].timestamp
        ).getTime();
        return timestampA - timestampB;
      });

      // Calculate how many nodes to remove
      const nodesToRemoveCount = nodeCount - this.maxMessages;

      // Remove the oldest branches
      let removedCount = 0;
      for (
        let i = 0;
        i < leafNodes.length && removedCount < nodesToRemoveCount;
        i++
      ) {
        removedCount += this.removeNodeAndUnusedAncestors(leafNodes[i]);
      }

      console.log(`Pruned ${removedCount} nodes from the tree`);
    }
  }

  findLeafNodes() {
    const leafNodes = [];

    for (const nodeId in this.conversationTree.nodes) {
      if (this.conversationTree.nodes[nodeId].childIds.length === 0) {
        leafNodes.push(nodeId);
      }
    }

    return leafNodes;
  }

  removeNodeAndUnusedAncestors(nodeId) {
    // Don't remove the root node
    if (nodeId === this.conversationTree.rootId) {
      return 0;
    }

    let removedCount = 0;
    const node = this.conversationTree.nodes[nodeId];

    if (!node) {
      return 0;
    }

    // Remove the node
    delete this.conversationTree.nodes[nodeId];
    removedCount++;

    // Remove this node from its parent's children array
    if (node.parentId && this.conversationTree.nodes[node.parentId]) {
      const parent = this.conversationTree.nodes[node.parentId];
      parent.childIds = parent.childIds.filter((id) => id !== nodeId);

      // If the parent now has no children and it's not the current branch or the root,
      // recursively remove it as well
      if (
        parent.childIds.length === 0 &&
        parent.id !== this.conversationTree.rootId &&
        parent.id !== this.lastMessageId
      ) {
        removedCount += this.removeNodeAndUnusedAncestors(parent.id);
      }
    }

    return removedCount;
  }

  clearConversationTree() {
    // Reset the tree
    this.conversationTree = {
      rootId: null,
      nodes: {},
    };
    this.lastMessageId = null;

    // Save the empty tree
    this.saveTreeToStorage();

    console.log("Conversation tree cleared");
  }

  loadTreeFromStorage() {
    try {
      const storedData = localStorage.getItem("chatgpt-conversation-tree");
      if (storedData) {
        this.conversationTree = JSON.parse(storedData);
        console.log("Loaded conversation tree from storage");
      }
    } catch (error) {
      console.error("Error loading tree from storage:", error);
    }
  }

  saveTreeToStorage() {
    try {
      localStorage.setItem(
        "chatgpt-conversation-tree",
        JSON.stringify(this.conversationTree)
      );
      console.log("Saved conversation tree to storage");

      // Notify any open popup or sidebar about the update
      chrome.runtime
        .sendMessage({
          action: "treeUpdated",
          tree: this.conversationTree,
        })
        .catch((err) => {
          // It's normal for this to fail if popup isn't open
          if (!err.message.includes("Could not establish connection")) {
            console.error("Error sending tree update:", err);
          }
        });
    } catch (error) {
      console.error("Error saving tree to storage:", error);
    }
  }

  highlightMessage(messageId) {
    // Find the message element with our ID
    const messageElement = document.querySelector(
      `[data-our-message-id="${messageId}"]`
    );
    if (!messageElement) {
      console.log(`Message element not found for ID: ${messageId}`);
      return;
    }

    // Add highlight class
    messageElement.classList.add("conversation-tree-highlight");

    // Scroll to the element
    messageElement.scrollIntoView({ behavior: "smooth", block: "center" });

    // Remove highlight after a delay
    setTimeout(() => {
      messageElement.classList.remove("conversation-tree-highlight");
    }, 3000);
  }

  injectSidebarToggle() {
    // Create the toggle button
    const button = document.createElement("button");
    button.className = "conversation-tree-toggle";
    button.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>';
    button.title = "Show Conversation Tree";

    // Add click event
    button.addEventListener("click", () => {
      this.toggleSidebar();
    });

    // Append to the page
    document.body.appendChild(button);
  }

  toggleSidebar() {
    let sidebar = document.getElementById("conversation-tree-sidebar");

    if (sidebar) {
      // Toggle existing sidebar
      sidebar.classList.toggle("conversation-tree-sidebar-open");
    } else {
      // Create and inject the sidebar
      sidebar = document.createElement("div");
      sidebar.id = "conversation-tree-sidebar";
      sidebar.className =
        "conversation-tree-sidebar conversation-tree-sidebar-open";

      // Create the iframe for the sidebar content
      const iframe = document.createElement("iframe");
      iframe.src = chrome.runtime.getURL("sidebar.html");
      sidebar.appendChild(iframe);

      // Add close button
      const closeButton = document.createElement("button");
      closeButton.className = "conversation-tree-sidebar-close";
      closeButton.innerHTML = "×";
      closeButton.addEventListener("click", () => {
        sidebar.classList.remove("conversation-tree-sidebar-open");
      });
      sidebar.appendChild(closeButton);

      document.body.appendChild(sidebar);
    }
  }
}

// Start the tracker when the page is loaded
window.addEventListener("load", () => {
  // Give the page a moment to initialize
  setTimeout(() => {
    window.conversationTracker = new ConversationTracker();
  }, 2000);
});

// Also initialize on content script load in case page is already loaded
if (document.readyState === "complete") {
  setTimeout(() => {
    window.conversationTracker = new ConversationTracker();
  }, 2000);
}
