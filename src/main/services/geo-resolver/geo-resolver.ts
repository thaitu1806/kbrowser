/**
 * Geo Resolver Service
 *
 * Resolves IP geolocation data (timezone, locale, language) by querying
 * ip-api.com through a proxy or directly. Used to auto-configure
 * fingerprint parameters to match the proxy's IP location.
 */

import http from 'http';
import net from 'net';

export interface GeoInfo {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  timezone: string;   // IANA e.g. 'America/Los_Angeles'
  locale: string;     // BCP 47 e.g. 'en-US'
  language: string;   // e.g. 'en'
}

/**
 * Country code → primary locale mapping.
 * Covers common proxy locations.
 */
const COUNTRY_LOCALE_MAP: Record<string, string> = {
  US: 'en-US',
  GB: 'en-GB',
  CA: 'en-CA',
  AU: 'en-AU',
  DE: 'de-DE',
  FR: 'fr-FR',
  ES: 'es-ES',
  IT: 'it-IT',
  PT: 'pt-PT',
  BR: 'pt-BR',
  NL: 'nl-NL',
  RU: 'ru-RU',
  JP: 'ja-JP',
  KR: 'ko-KR',
  CN: 'zh-CN',
  TW: 'zh-TW',
  HK: 'zh-HK',
  SG: 'en-SG',
  IN: 'hi-IN',
  TH: 'th-TH',
  VN: 'vi-VN',
  ID: 'id-ID',
  MY: 'ms-MY',
  PH: 'en-PH',
  MX: 'es-MX',
  AR: 'es-AR',
  CL: 'es-CL',
  CO: 'es-CO',
  PL: 'pl-PL',
  UA: 'uk-UA',
  TR: 'tr-TR',
  SA: 'ar-SA',
  AE: 'ar-AE',
  EG: 'ar-EG',
  IL: 'he-IL',
  SE: 'sv-SE',
  NO: 'nb-NO',
  DK: 'da-DK',
  FI: 'fi-FI',
  CZ: 'cs-CZ',
  RO: 'ro-RO',
  HU: 'hu-HU',
  GR: 'el-GR',
  AT: 'de-AT',
  CH: 'de-CH',
  BE: 'nl-BE',
  IE: 'en-IE',
  NZ: 'en-NZ',
  ZA: 'en-ZA',
};

/**
 * Resolve geo info by making a request to ip-api.com directly (no proxy).
 * Useful for getting the machine's own IP info.
 */
export async function resolveGeoFromIP(): Promise<GeoInfo> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Geo lookup timeout')), 10000);

    const req = http.get(
      'http://ip-api.com/json/?fields=query,country,countryCode,regionName,city,timezone,status',
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(data);
            if (json.status !== 'success') {
              reject(new Error('ip-api returned non-success'));
              return;
            }
            const countryCode = json.countryCode || 'US';
            const locale = COUNTRY_LOCALE_MAP[countryCode] || 'en-US';
            resolve({
              ip: json.query,
              country: json.country,
              countryCode,
              region: json.regionName,
              city: json.city,
              timezone: json.timezone || 'America/New_York',
              locale,
              language: locale.split('-')[0],
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

/**
 * Resolve geo info by routing the request through a proxy.
 * Supports HTTP and SOCKS5 proxies.
 *
 * @param proxy - Proxy configuration with protocol, host, port, and optional auth
 * @returns GeoInfo with timezone, locale, etc. based on the proxy's exit IP
 */
export async function resolveGeoFromProxy(proxy: {
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}): Promise<GeoInfo> {
  const checkerHost = 'ip-api.com';
  const checkerPath = '/json/?fields=query,country,countryCode,regionName,city,timezone,status';

  if (proxy.protocol === 'socks5') {
    return resolveViaSocks5(proxy, checkerHost, checkerPath);
  }
  return resolveViaHttp(proxy, checkerHost, checkerPath);
}

async function resolveViaSocks5(
  proxy: { host: string; port: number; username?: string; password?: string },
  checkerHost: string,
  checkerPath: string,
): Promise<GeoInfo> {
  const { SocksClient } = await import('socks');

  const socksOptions: import('socks').SocksClientOptions = {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5,
      userId: proxy.username || undefined,
      password: proxy.password || undefined,
    },
    command: 'connect' as const,
    destination: { host: checkerHost, port: 80 },
    timeout: 10000,
  };

  const { socket } = await SocksClient.createConnection(socksOptions);
  return httpGetOverSocket(socket, checkerHost, checkerPath);
}

async function resolveViaHttp(
  proxy: { protocol: string; host: string; port: number; username?: string; password?: string },
  checkerHost: string,
  checkerPath: string,
): Promise<GeoInfo> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Geo lookup timeout')), 10000);

    const options: http.RequestOptions = {
      host: proxy.host,
      port: proxy.port,
      path: `http://${checkerHost}${checkerPath}`,
      method: 'GET',
      headers: {
        Host: checkerHost,
        Accept: 'application/json',
      },
    };

    if (proxy.username && proxy.password) {
      options.headers = {
        ...options.headers,
        'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64'),
      };
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          resolve(parseGeoResponse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    req.end();
  });
}

function httpGetOverSocket(
  socket: net.Socket,
  checkerHost: string,
  checkerPath: string,
): Promise<GeoInfo> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Geo lookup timeout'));
    }, 10000);

    const reqStr = `GET ${checkerPath} HTTP/1.1\r\nHost: ${checkerHost}\r\nConnection: close\r\nAccept: application/json\r\n\r\n`;
    socket.write(reqStr);

    let rawData = '';
    socket.on('data', (chunk: Buffer) => { rawData += chunk.toString(); });
    socket.on('end', () => {
      clearTimeout(timeout);
      try {
        // Extract body from HTTP response
        const bodyStart = rawData.indexOf('\r\n\r\n');
        let body = bodyStart >= 0 ? rawData.slice(bodyStart + 4) : rawData;

        // Handle chunked transfer encoding
        if (rawData.toLowerCase().includes('transfer-encoding: chunked')) {
          const chunks: string[] = [];
          let remaining = body;
          while (remaining.length > 0) {
            const lineEnd = remaining.indexOf('\r\n');
            if (lineEnd < 0) break;
            const chunkSize = parseInt(remaining.slice(0, lineEnd), 16);
            if (isNaN(chunkSize) || chunkSize === 0) break;
            chunks.push(remaining.slice(lineEnd + 2, lineEnd + 2 + chunkSize));
            remaining = remaining.slice(lineEnd + 2 + chunkSize + 2);
          }
          body = chunks.join('');
        }

        resolve(parseGeoResponse(body.trim()));
      } catch (e) {
        reject(e);
      }
    });
    socket.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

function parseGeoResponse(data: string): GeoInfo {
  const json = JSON.parse(data);
  if (json.status !== 'success') {
    throw new Error(`ip-api returned: ${json.message || 'non-success'}`);
  }

  const countryCode = json.countryCode || 'US';
  const locale = COUNTRY_LOCALE_MAP[countryCode] || 'en-US';

  return {
    ip: json.query,
    country: json.country,
    countryCode,
    region: json.regionName,
    city: json.city,
    timezone: json.timezone || 'America/New_York',
    locale,
    language: locale.split('-')[0],
  };
}
