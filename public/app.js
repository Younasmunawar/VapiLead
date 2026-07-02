const form = document.getElementById("leadForm");
const submitButton = document.getElementById("submitButton");
const callArea = document.getElementById("callArea");
const statusBox = document.getElementById("status");
const micGate = document.getElementById("micGate");
const micGateText = document.getElementById("micGateText");
const micHelp = document.getElementById("micHelp");
const micPermissionButton = document.getElementById("micPermissionButton");
const micReadyBadge = document.getElementById("micReadyBadge");

let currentLeadId = "";
let vapiInstance = null;
let callId = "";
let finalSegments = [];
let latestPartialByRole = new Map();
let completionSent = false;
let microphoneReady = false;
let analysisPollTimer = null;
let browserStopRequested = false;

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle("error", isError);
}

function buildTranscript() {
  const partials = [...latestPartialByRole.entries()].map(
    ([role, text]) => `${role}: ${text}`
  );
  return [...finalSegments, ...partials].join("\n").trim();
}

async function postJson(url, payload, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed with ${response.status}`);
  }
  return data;
}

function microphoneHelpMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Microphone access was blocked. Click the lock/settings icon beside the website address, set Microphone to Allow, then reload this page.";
  }

  if (error?.name === "NotFoundError") {
    return "No microphone was found. Connect a microphone or headset, then try again.";
  }

  if (error?.name === "NotReadableError") {
    return "Your microphone is being used by another app. Close that app and try again.";
  }

  return "We could not access the microphone. Check your browser microphone setting and try again.";
}

async function requestMicrophonePermission() {
  micPermissionButton.disabled = true;
  micGateText.textContent = "Please choose Allow when your browser asks for microphone access.";
  micHelp.hidden = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone access.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Permission is now granted. Release the temporary stream so Vapi can open it later.
    stream.getTracks().forEach((track) => track.stop());

    microphoneReady = true;
    micReadyBadge.hidden = false;
    micGate.classList.add("mic-gate-hidden");
    setStatus("Microphone is ready. Complete the form to continue.");
  } catch (error) {
    console.error("Microphone permission error:", error);
    microphoneReady = false;
    micHelp.textContent = microphoneHelpMessage(error);
    micHelp.hidden = false;
    micGateText.textContent = "Microphone access is required before the call can start.";
    micPermissionButton.textContent = "Try microphone again";
  } finally {
    micPermissionButton.disabled = false;
  }
}

async function checkExistingMicrophonePermission() {
  try {
    if (!navigator.permissions?.query) return false;
    const permission = await navigator.permissions.query({ name: "microphone" });

    if (permission.state === "granted") {
      await requestMicrophonePermission();
      return true;
    }

    if (permission.state === "denied") {
      micHelp.textContent = microphoneHelpMessage({ name: "NotAllowedError" });
      micHelp.hidden = false;
      micGateText.textContent = "Microphone access is currently blocked for this website.";
      micPermissionButton.textContent = "Check microphone again";
      return true;
    }
  } catch {
    // Some browsers do not support querying microphone permission.
  }

  return false;
}

async function initializeMicrophoneGate() {
  const handled = await checkExistingMicrophonePermission();
  if (!handled) {
    // This immediately triggers the browser's native permission prompt on first visit.
    await requestMicrophonePermission();
  }
}

async function pollForAnalysis() {
  if (!currentLeadId) return;

  let attempts = 0;
  const maxAttempts = 30;

  clearInterval(analysisPollTimer);
  analysisPollTimer = setInterval(async () => {
    attempts += 1;

    try {
      const response = await fetch(`/api/leads/${currentLeadId}`);
      const data = await response.json();
      const lead = data.lead;

      if (lead?.status === "completed") {
        clearInterval(analysisPollTimer);
        setStatus("Analysis complete. The lead is saved and the email notification has been processed.");
        return;
      }

      if (lead?.status === "failed") {
        clearInterval(analysisPollTimer);
        setStatus(`Analysis failed: ${lead.processingError || "Please review Render logs."}`, true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(analysisPollTimer);
        setStatus("Call saved. Vapi analysis is still processing; check the dashboard shortly.");
      }
    } catch (error) {
      console.warn("Analysis polling error:", error.message);
    }
  }, 3000);
}

async function completeLead() {
  if (!currentLeadId || completionSent) return;
  completionSent = true;

  setStatus("Call ended. Waiting for Vapi to analyze the conversation...");

  try {
    await postJson(`/api/leads/${currentLeadId}/complete`, {
      callId,
      transcript: buildTranscript()
    });

    await pollForAnalysis();
  } catch (error) {
    completionSent = false;
    setStatus(`The call ended, but saving failed: ${error.message}`, true);
  }
}

function handleMessage(message) {
  if (!message || message.type !== "transcript") return;

  const role = message.role || "speaker";
  const text = String(message.transcript || "").trim();
  if (!text) return;

  const transcriptType = message.transcriptType || message.transcript_type;

  if (transcriptType === "final") {
    finalSegments.push(`${role}: ${text}`);
    latestPartialByRole.delete(role);

    // Browser-side safety fallback. The Vapi End Call tool should be primary,
    // but this guarantees the web call closes after Kenny's exact final line.
    const normalizedRole = String(role).toLowerCase();
    const normalizedText = text.toLowerCase().replace(/[’]/g, "'");
    const isAssistant = normalizedRole === "assistant" || normalizedRole === "bot";
    const isFinalClosing =
      normalizedText.includes("thank you for speaking with falcon heights") &&
      normalizedText.includes("end the call now") &&
      normalizedText.includes("goodbye");

    if (isAssistant && isFinalClosing && !browserStopRequested) {
      browserStopRequested = true;
      setStatus("Kenny has completed the call. Disconnecting...");

      setTimeout(() => {
        try {
          vapiInstance?.stop?.();
        } catch (error) {
          console.warn("Browser stop fallback failed:", error.message);
        }
      }, 900);
    }
  } else {
    latestPartialByRole.set(role, text);
  }
}

async function mountVapiWidget() {
  const configResponse = await fetch("/api/config");
  const config = await configResponse.json();

  if (!config.vapiPublicKey || !config.vapiAssistantId) {
    throw new Error("Vapi public key or assistant ID is missing in Render environment variables.");
  }

  await new Promise((resolve, reject) => {
    const existing = document.getElementById("vapi-html-sdk");
    if (existing) {
      if (window.vapiSDK) resolve();
      else existing.addEventListener("load", resolve, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "vapi-html-sdk";
    script.src =
      "https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the Vapi browser SDK."));
    document.head.appendChild(script);
  });

  vapiInstance = window.vapiSDK.run({
    apiKey: config.vapiPublicKey,
    assistant: config.vapiAssistantId,
    config: {
      position: "bottom-right",
      offset: "28px",
      width: "64px",
      height: "64px",
      idle: {
        color: "#176b4d",
        type: "round",
        title: "Talk to Kenny",
        subtitle: "Start voice call"
      },
      loading: {
        color: "#59645f",
        type: "round",
        title: "Connecting",
        subtitle: "Please wait"
      },
      active: {
        color: "#a32d2d",
        type: "round",
        title: "Call in progress",
        subtitle: "Tap to end"
      }
    }
  });

  if (vapiInstance?.on) {
    vapiInstance.on("call-start", async (call) => {
      callId = String(call?.id || "");
      completionSent = false;
      browserStopRequested = false;
      finalSegments = [];
      latestPartialByRole.clear();
      setStatus("Connected. You are speaking with Kenny.");

      try {
        await postJson(
          `/api/leads/${currentLeadId}/call-start`,
          { callId },
          "PATCH"
        );
      } catch (error) {
        console.warn("Could not update call-start:", error.message);
      }
    });

    vapiInstance.on("message", handleMessage);
    vapiInstance.on("call-end", completeLead);
    vapiInstance.on("error", (error) => {
      console.error(error);
      setStatus("Vapi call error. Please refresh the page and try again.", true);
    });
  }
}

micPermissionButton.addEventListener("click", requestMicrophonePermission);

document.addEventListener("DOMContentLoaded", initializeMicrophoneGate);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!microphoneReady) {
    micGate.classList.remove("mic-gate-hidden");
    setStatus("Please enable microphone access before continuing.", true);
    return;
  }

  submitButton.disabled = true;
  setStatus("Saving your details...");

  try {
    const result = await postJson("/api/leads", {
      name: document.getElementById("name").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      email: document.getElementById("email").value.trim()
    });

    currentLeadId = result.lead._id;
    localStorage.setItem("kennyLeadId", currentLeadId);

    form.hidden = true;
    callArea.hidden = false;
    setStatus("Details saved. Press the green call button to start.");

    await mountVapiWidget();
  } catch (error) {
    setStatus(error.message, true);
    submitButton.disabled = false;
  }
});
