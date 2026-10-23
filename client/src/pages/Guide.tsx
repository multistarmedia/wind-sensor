import { BlockStack, Text } from '@shopify/polaris';

export const GUIDE_VIDEO = '/videos/getting-started.mp4';

export function Guide() {
  return (
    <div className="page-narrow guide">
      <BlockStack gap="400">
        <Text as="h1" variant="headingXl">Getting started</Text>
        <Text as="p" tone="subdued">
          A 2½-minute walkthrough: signing in, setup, connecting the sensor, reading the wind dial, history, the log, and viewing on a phone.
          Dashboard scenes use demo mode; the history and log scenes use simulated readings, labelled on screen.
        </Text>
        <video className="guide-video" src={GUIDE_VIDEO} poster="/videos/getting-started.jpg" controls preload="metadata" playsInline />
        <Text as="p" variant="bodySm" tone="subdued">
          Captions are built in. <a href={GUIDE_VIDEO} download>Download the video</a>.
        </Text>
      </BlockStack>
    </div>
  );
}
