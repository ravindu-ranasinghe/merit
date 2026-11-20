// Paste this into the existing Arc Logs Stream; preserve its cursor, destination and security token.
function main(stream) {
  var ESCROW = "0x924525bf3f3a39f9c7f298e71aff43f4c27a4727";
  var logs = [];
  function walk(x) {
    if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) walk(x[i]); return; }
    if (x && typeof x === "object") {
      if (typeof x.address === "string" && Array.isArray(x.topics)) {
        if (x.address.toLowerCase() === ESCROW) logs.push(x);
        return;
      }
      for (var k in x) walk(x[k]);
    }
  }
  walk(stream && stream.data);
  var metadata = stream && stream.metadata || {};
  // Empty corrected blocks must still remove previously indexed logs. Metadata belongs inside the HMAC body.
  return logs.length || (metadata.reorgs || []).length || (metadata.blocks_reorged || []).length
    ? { data: logs, metadata: metadata } : null;
}
