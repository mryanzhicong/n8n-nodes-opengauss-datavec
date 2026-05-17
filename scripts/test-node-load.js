// Test that the node module loads correctly
const pkg = require('/root/n8n/n8n-nodes-opengauss-datavec/dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js');
const credPkg = require('/root/n8n/n8n-nodes-opengauss-datavec/dist/credentials/OpenGaussDataVec.credentials.js');

console.log('=== Node Load Test ===\n');

// Test node class
const cls = pkg.VectorStoreOpenGauss;
const inst = new cls();
console.log('Node displayName:', inst.description.displayName);
console.log('Node name:', inst.description.name);
console.log('Node version:', inst.description.version);
console.log('Node group:', inst.description.group);
console.log('Operations:', inst.description.properties[0].options.map(o => `${o.name} (${o.value})`).join(', '));
console.log('Credentials:', inst.description.credentials.map(c => c.name).join(', '));
console.log('Has execute method:', typeof inst.execute === 'function');
console.log('Has credentialTest:', !!inst.methods?.credentialTest?.openGaussConnectionTest);

// Test credential class
const credCls = credPkg.OpenGaussDataVec;
const credInst = new credCls();
console.log('\n=== Credential Load Test ===\n');
console.log('Credential name:', credInst.name);
console.log('Credential displayName:', credInst.displayName);
console.log('Properties:', credInst.properties.map(p => p.name).join(', '));

console.log('\n✓ Node and credential modules loaded successfully!');
