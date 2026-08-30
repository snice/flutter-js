// Binary UI op protocol shared between fjs-runtime (TypeScript) and this
// decoder. Frames arrive from JS via __fjs.fns.uiOps(Uint8Array); one call
// is one frame = a batch of back-to-back ops (little-endian).
//
//  op 1 CREATE        u32 id, u16 tagLen, utf8 tag
//  op 2 REMOVE        u32 id
//  op 3 INSERT        u32 parent, u32 child, u32 index
//  op 4 REMOVE_CHILD  u32 parent, u32 child
//  op 5 SET_TEXT      u32 id, u32 len, utf8 text
//  op 6 SET_PROPS     u32 id, u32 jsonLen, utf8 JSON
//
// Parent id 0 refers to the implicit root container owned by the host.
// Props is a flat JSON object; style values are strings/numbers (see
// docs/ui-api.md for the full property reference).
abstract final class UiOpCode {
  static const create = 1;
  static const remove = 2;
  static const insert = 3;
  static const removeChild = 4;
  static const setText = 5;
  static const setProps = 6;
}
