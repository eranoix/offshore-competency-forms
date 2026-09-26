/**
 * The page reader, loaded when a page first has to be drawn: it is most of what
 * this site weighs and only two screens use it, so it stays out of the home page.
 */
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let reader;
export const readerReady = () => {
  reader =
    reader ||
    import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    });
  return reader;
};
