const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════
// 실시간 채팅 및 게임 이벤트 시스템
// ════════════════════════════════════════════════════════════

// 채팅 채널: 세계 채팅, 종족별 국가 채팅, 귓말
const rooms = {
  world: new Set(),
  nation_human: new Set(),
  nation_elf: new Set(),
  nation_dwarf: new Set(),
  nation_demon: new Set(),
};

// 플레이어 정보 저장 (레벨업 공지, 접속자 추적용)
const players = new Map(); // ws -> {name, race, lv, ...}

let onlineCount = 0;

// ════════════════════════════════════════════════════════════
// WebSocket 연결 처리
// ════════════════════════════════════════════════════════════
wss.on('connection', (ws) => {
  // 초기 상태
  ws.race    = 'human';
  ws.name    = '익명';
  ws.room    = 'world';
  ws.alive   = true;
  ws.lv      = 1;

  onlineCount++;
  rooms['world'].add(ws);
  broadcastOnline();

  // ──────────────────────────────────────────────────────
  // 메시지 처리
  // ──────────────────────────────────────────────────────
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    // 1. 플레이어 입장
    if (msg.type === 'join') {
      ws.race = msg.race || 'human';
      ws.name = msg.name || '익명';
      ws.lv   = msg.lv || 1;
      ws.room = 'world';

      // 플레이어 정보 저장
      players.set(ws, { name: ws.name, race: ws.race, lv: ws.lv });

      // 입장 공지 (시스템 메시지)
      const joinMsg = JSON.stringify({
        type: 'chat',
        channel: 'world',
        race: 'system',
        name: 'SYSTEM',
        text: `[입장] ${ws.name}(${ws.race}) 접속했습니다.`,
        ts: Date.now(),
      });
      broadcast(rooms['world'], joinMsg);
      broadcastOnline();

    // 2. 일반 채팅
    } else if (msg.type === 'chat') {
      const channel = msg.channel || 'world';
      const text = String(msg.text || '').slice(0, 200);

      // 빈 메시지 무시
      if (!text.trim()) return;

      const packet = JSON.stringify({
        type: 'chat',
        race: ws.race,
        name: ws.name,
        text: text,
        channel: channel,
        ts: Date.now(),
      });

      // 채널별 브로드캐스트
      if (channel === 'world') {
        // 세계 채팅: 모든 플레이어에게 전송 (자신 제외)
        broadcast(rooms['world'], packet, ws);
      } else if (channel === 'nation') {
        // 국가 채팅: 같은 종족끼리만 전송
        const nationRoom = rooms[`nation_${ws.race}`];
        if (nationRoom) {
          broadcast(nationRoom, packet, ws);
        }
      } else if (channel === 'whisper') {
        // 귓말: 아직 구현 안 됨 (프론트엔드에서 준비 중)
        return;
      }

    // 3. 레벨업 공지
    } else if (msg.type === 'lvup') {
      const lvupMsg = JSON.stringify({
        type: 'lvup',
        race: msg.race || ws.race,
        name: msg.name || ws.name,
        lv: msg.lv || 1,
        ts: Date.now(),
      });

      // 플레이어 정보 업데이트
      if (players.has(ws)) {
        const playerInfo = players.get(ws);
        playerInfo.lv = msg.lv;
      }

      // 세계 채팅에 공지
      broadcast(rooms['world'], lvupMsg);

      // 시스템 메시지로도 전송
      const sysMsg = JSON.stringify({
        type: 'chat',
        channel: 'world',
        race: 'system',
        name: 'SYSTEM',
        text: `🎉 ${msg.name} Lv.${msg.lv} 달성!`,
        ts: Date.now(),
      });
      broadcast(rooms['world'], sysMsg);

    // 4. 국가 채팅 채널 입장
    } else if (msg.type === 'join_nation') {
      const key = `nation_${ws.race}`;
      if (!rooms[key]) {
        rooms[key] = new Set();
      }
      rooms[key].add(ws);

      // 입장 공지
      const nationJoinMsg = JSON.stringify({
        type: 'chat',
        channel: 'nation',
        race: 'system',
        name: 'SYSTEM',
        text: `${ws.name}이(가) ${ws.race} 국가 채널에 입장했습니다.`,
        ts: Date.now(),
      });
      broadcast(rooms[key], nationJoinMsg);
    }
  });

  // ──────────────────────────────────────────────────────
  // 핑/퐁 (연결 유지)
  // ──────────────────────────────────────────────────────
  ws.on('pong', () => {
    ws.alive = true;
  });

  // ──────────────────────────────────────────────────────
  // 연결 종료
  // ──────────────────────────────────────────────────────
  ws.on('close', () => {
    // 플레이어 정보 제거
    const playerInfo = players.get(ws);
    if (playerInfo) {
      const leaveMsg = JSON.stringify({
        type: 'chat',
        channel: 'world',
        race: 'system',
        name: 'SYSTEM',
        text: `[퇴장] ${playerInfo.name}이(가) 접속을 종료했습니다.`,
        ts: Date.now(),
      });
      broadcast(rooms['world'], leaveMsg);
      players.delete(ws);
    }

    // 접속자 수 업데이트
    onlineCount = Math.max(0, onlineCount - 1);

    // 모든 채널에서 제거
    Object.values(rooms).forEach(room => {
      room.delete(ws);
    });

    broadcastOnline();
  });

  // ──────────────────────────────────────────────────────
  // 에러 처리
  // ──────────────────────────────────────────────────────
  ws.on('error', (err) => {
    console.error('WebSocket 에러:', err);
  });
});

// ════════════════════════════════════════════════════════════
// 헬퍼 함수
// ════════════════════════════════════════════════════════════

/**
 * 특정 채팅방의 모든 클라이언트에게 메시지 전송
 * @param {Set} room - 채팅방 (클라이언트 Set)
 * @param {string} data - 전송할 JSON 문자열
 * @param {WebSocket} except - 제외할 클라이언트 (보통 발신자)
 */
function broadcast(room, data, except) {
  room.forEach(client => {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (err) {
        console.error('메시지 전송 실패:', err);
      }
    }
  });
}

/**
 * 모든 접속자에게 현재 접속자 수 공지
 */
function broadcastOnline() {
  const packet = JSON.stringify({
    type: 'online',
    count: onlineCount,
  });

  rooms['world'].forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(packet);
      } catch (err) {
        console.error('접속자 수 공지 실패:', err);
      }
    }
  });
}

/**
 * 주기적으로 연결 상태 확인 (heartbeat)
 * 응답 없는 클라이언트는 자동 종료
 */
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.alive === false) {
      return ws.terminate();
    }
    ws.alive = false;
    ws.ping();
  });
}, 30000); // 30초마다 확인

// ════════════════════════════════════════════════════════════
// HTTP 라우트 (선택 사항)
// ════════════════════════════════════════════════════════════

// 기본 상태 확인
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    onlineCount: onlineCount,
    timestamp: Date.now(),
  });
});

// 접속자 수 조회
app.get('/api/online', (req, res) => {
  res.json({
    count: onlineCount,
  });
});

// ════════════════════════════════════════════════════════════
// 서버 시작
// ════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 판타챗 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP: http://localhost:${PORT}`);
});

// 우아한 종료 처리
process.on('SIGTERM', () => {
  console.log('SIGTERM 신호 수신. 서버 종료 중...');
  server.close(() => {
    console.log('서버 종료 완료.');
    process.exit(0);
  });
});
