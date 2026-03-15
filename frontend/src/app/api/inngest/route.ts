import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { processVideoClip, processThumbnail, processAvatar } from "../../../inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processVideoClip,
    processThumbnail,
    processAvatar,
  ],
});
