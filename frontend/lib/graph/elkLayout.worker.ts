// Runs inside a dedicated Worker. Imports the self-contained elkjs browser
// bundle so layout math never touches the main thread — 500 nodes of layered
// layout would jank it.
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

export interface ElkWorkerRequest {
  requestId: number;
  graph: ElkNode;
}

export type ElkWorkerResponse =
  | { requestId: number; layout: ElkNode; error?: undefined }
  | { requestId: number; layout?: undefined; error: string };

// Typed narrowly instead of pulling in the "webworker" lib globally — that
// lib redeclares `self`/`postMessage` and collides with the "dom" lib this
// project's tsconfig already loads for the main thread code in the same
// program.
interface WorkerScope {
  onmessage: ((event: MessageEvent<ElkWorkerRequest>) => void) | null;
  postMessage(message: ElkWorkerResponse): void;
}

const workerSelf = self as unknown as WorkerScope;
const elk = new ELK();

workerSelf.onmessage = (event) => {
  const { requestId, graph } = event.data;
  elk
    .layout(graph)
    .then((layout) => workerSelf.postMessage({ requestId, layout }))
    .catch((error: unknown) =>
      workerSelf.postMessage({
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
};
