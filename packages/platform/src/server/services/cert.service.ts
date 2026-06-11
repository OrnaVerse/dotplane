import forge from 'node-forge'

const CERT_VALIDITY_DAYS = 3650
const KEY_SIZE = 2048
const CA_KEY_SIZE = 4096

export interface PemKeyPair {
  certPem: string
  keyPem: string
}

export interface CaMaterial extends PemKeyPair {
  cert: forge.pki.Certificate
  privateKey: forge.pki.PrivateKey
}

function toPemCert(cert: forge.pki.Certificate): string {
  return forge.pki.certificateToPem(cert)
}

function toPemKey(key: forge.pki.PrivateKey): string {
  return forge.pki.privateKeyToPem(key)
}

function createCertSubject(cn: string): forge.pki.CertificateField[] {
  return [
    { name: 'commonName', value: cn },
    { name: 'organizationName', value: 'Dotplane' },
  ]
}

export function generateCaCert(): CaMaterial {
  const keys = forge.pki.rsa.generateKeyPair(CA_KEY_SIZE)
  const cert = forge.pki.createCertificate()

  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + CERT_VALIDITY_DAYS)

  cert.setSubject(createCertSubject('Dotplane CA'))
  cert.setIssuer(createCertSubject('Dotplane CA'))
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true },
  ])

  cert.sign(keys.privateKey, forge.md.sha256.create())

  return {
    cert,
    privateKey: keys.privateKey,
    certPem: toPemCert(cert),
    keyPem: toPemKey(keys.privateKey),
  }
}

export function generateSignedCert(
  cn: string,
  ca: CaMaterial,
  altNames?: string[],
): PemKeyPair {
  const keys = forge.pki.rsa.generateKeyPair(KEY_SIZE)
  const cert = forge.pki.createCertificate()

  cert.publicKey = keys.publicKey
  cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8))
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + CERT_VALIDITY_DAYS)

  cert.setSubject(createCertSubject(cn))
  cert.setIssuer(ca.cert.subject.attributes)

  const extensions: Array<{ name: string; [key: string]: unknown }> = [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
  ]

  if (altNames?.length) {
    extensions.push({
      name: 'subjectAltName',
      altNames: altNames.map((value) => ({ type: 2, value })),
    })
  }

  cert.setExtensions(extensions)
  cert.sign(ca.privateKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create())

  return {
    certPem: toPemCert(cert),
    keyPem: toPemKey(keys.privateKey),
  }
}

export function generatePlatformClientCert(ca: CaMaterial): PemKeyPair {
  return generateSignedCert('dotplane-platform', ca)
}

export function generateAgentServerCert(serverId: string, hostname: string, ca: CaMaterial): PemKeyPair {
  return generateSignedCert(`dotplane-agent-${serverId}`, ca, [hostname, 'localhost'])
}
