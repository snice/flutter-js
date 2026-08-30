// Shared callback signature: how a component reports an event back to JS.
//
// [nodeId] is the mirror-tree node the event happened on, [type] one of the
// ids in [FjsEvent], and [text] the optional payload (input text, page index,
// scroll offset...). Backed by FjsEngine.dispatchEvent.
typedef FjsDispatch = void Function(int nodeId, int type, {String? text});
