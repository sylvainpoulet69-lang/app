# app

## Editor listener lifecycle

The editor binds temporary click handlers when defining an answer for a stop.
Each step first removes any previous handler before attaching a new one and
most handlers are registered with `{ once: true }`. This ensures that repeated
invocations (or an aborted action) do not accumulate duplicate listeners.
The helper `cleanupEditorClickHandlers()` in `app.js` can be called to cancel
any in-progress editor interaction.