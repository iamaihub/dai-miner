import { startWorker } from "@qvac/sdk/worker"
import { llmPlugin } from "@qvac/sdk/llamacpp-completion/plugin"
import { embeddingsPlugin } from "@qvac/sdk/llamacpp-embedding/plugin"
import { decisionPlugin } from "@qvac/sdk/llamacpp-decision/plugin"

export default function start(ipc, ready) {
  return startWorker(ipc, ready, { plugins: [llmPlugin, embeddingsPlugin, decisionPlugin] })
}
