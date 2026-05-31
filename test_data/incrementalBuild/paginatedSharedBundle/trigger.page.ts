import { html, js, type YetiPageComponent } from "../../../src/index.ts";

// A normal (non-paginated) page that contributes to the shared "global" JS bundle via an imported
// file. Modifying `trigger-dep.js` changes the merged "global" bundle's content hash, which must
// then propagate to the unchanged paginated `slug.page.ts` outputs in the incremental pass.
const TriggerPage: YetiPageComponent = () => html`
<html lang="en">
  <head>
    <title>Trigger</title>
    <script src="${js.src("global")}"></script>
  </head>
  <body><h1>Trigger</h1></body>
</html>
`;

TriggerPage.js = js`
  ${js.bundle("global")}
  ${js.import("./trigger-dep.js")}
`;

export default TriggerPage;
