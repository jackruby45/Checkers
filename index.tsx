/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- TYPE DEFINITIONS AND CONSTANTS ---
const PLAYER_1_PIECE = 'r';
const PLAYER_2_PIECE = 'b';
const PLAYER_1_KING = 'R';
const PLAYER_2_KING = 'B';
const EMPTY = null;

type Piece = typeof PLAYER_1_PIECE | typeof PLAYER_2_PIECE | typeof PLAYER_1_KING | typeof PLAYER_2_KING;
type SquareContent = Piece | typeof EMPTY;
type Board = SquareContent[][];
type Move = { from: [number, number], to: [number, number] };
type PlayerRole = typeof PLAYER_1_PIECE | typeof PLAYER_2_PIECE;

type GameState = {
    gameId: string;
    board: Board;
    currentPlayer: PlayerRole;
    player1Name: string;
    player2Name: string | null;
    isGameOver: boolean;
    winner: PlayerRole | null;
};

type GameMessage = {
    type: 'game_state';
    payload: GameState;
} | {
    type: 'player_join';
    payload: { playerName: string };
} | {
    type: 'chat_message',
    payload: { senderName: string, text: string }
};

const REALTIME_TOPIC_PREFIX = 'checkers-game-';

// --- DOM ELEMENTS ---
const lobbyContainer = document.getElementById('lobby-container')!;
const nameForm = document.getElementById('name-form')!;
const playerNameInput = document.getElementById('player-name') as HTMLInputElement;
const playFriendButton = document.getElementById('play-friend-button')!;

const waitingRoomContainer = document.getElementById('waiting-room-container')!;
const shareLinkInput = document.getElementById('share-link-input') as HTMLInputElement;
const copyLinkButton = document.getElementById('copy-link-button')!;

const gameContent = document.getElementById('game-content')!;
const boardContainer = document.getElementById('board-container')!;
const boardElement = document.getElementById('board')!;
const statusDisplay = document.getElementById('status-display')!;
const resetButton = document.getElementById('reset-button')!;
const player1Label = document.getElementById('player-1-label')!;
const player2Label = document.getElementById('player-2-label')!;

const chatContainer = document.getElementById('chat-container')!;
const chatMessages = document.getElementById('chat-messages')!;
const chatForm = document.getElementById('chat-form')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;


// --- GAME STATE ---
let gameState: GameState | null = null;
let localPlayerRole: PlayerRole | null = null;
let selectedPiece: { row: number, col: number } | null = null;
let validMovesForSelectedPiece: Move[] = [];

// --- REAL-TIME COMMUNICATION ---

async function listenForGameEvents(gameId: string) {
    const topic = `${REALTIME_TOPIC_PREFIX}${gameId}`;
    const controller = new AbortController();

    try {
        const response = await fetch(`https://ntfy.sh/${topic}/json`, {
            signal: controller.signal,
        });

        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.event === 'message') {
                        const message: GameMessage = JSON.parse(data.message);
                        handleIncomingMessage(message);
                    }
                } catch (e) {
                    console.error("Error parsing message chunk: ", e);
                }
            }
        }
    } catch (error) {
        if ((error as Error).name !== 'AbortError') {
            console.error("Connection error, retrying...", error);
            setTimeout(() => listenForGameEvents(gameId), 3000);
        }
    }
}

async function sendGameMessage(gameId: string, message: GameMessage) {
    const topic = `${REALTIME_TOPIC_PREFIX}${gameId}`;
    try {
        await fetch(`https://ntfy.sh/${topic}`, {
            method: 'POST',
            body: JSON.stringify(message),
        });
    } catch (error) {
        console.error("Failed to send message:", error);
        updateStatus("Connection error! Can't send move.");
    }
}

// --- GAME LOGIC ---

function createInitialBoard(): Board {
    const board: Board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
    for (let i = 0; i < 8; i++) {
        // Player 2 pieces (top rows)
        if (i < 3) {
            for (let j = 0; j < 8; j++) {
                if ((i + j) % 2 !== 0) board[i][j] = PLAYER_2_PIECE;
            }
        }
        // Player 1 pieces (bottom rows)
        if (i > 4) {
            for (let j = 0; j < 8; j++) {
                if ((i + j) % 2 !== 0) board[i][j] = PLAYER_1_PIECE;
            }
        }
    }
    return board;
}

function getAllValidMoves(board: Board, player: PlayerRole): Move[] {
    const allMoves: Move[] = [];
    const playerPieces = player === PLAYER_1_PIECE ? [PLAYER_1_PIECE, PLAYER_1_KING] : [PLAYER_2_PIECE, PLAYER_2_KING];
    const mandatoryJumps: Move[] = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && playerPieces.includes(piece as Piece)) {
                mandatoryJumps.push(...getJumpsForPiece(board, r, c));
            }
        }
    }
    if (mandatoryJumps.length > 0) return mandatoryJumps;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && playerPieces.includes(piece as Piece)) {
                allMoves.push(...getMovesForPiece(board, r, c));
            }
        }
    }
    return allMoves;
}

function getMovesForPiece(board: Board, r: number, c: number): Move[] {
    const piece = board[r][c];
    if (!piece) return [];
    const moves: Move[] = [];
    const moveDirs = getMoveDirections(piece);

    // Standard moves
    for (const [dr, dc] of moveDirs) {
        const newR = r + dr, newC = c + dc;
        if (isValidSquare(newR, newC) && board[newR][newC] === EMPTY) {
            moves.push({ from: [r, c], to: [newR, newC] });
        }
    }

    // Jumps (handled by getJumpsForPiece, but needed for move generation)
    moves.push(...getJumpsForPiece(board, r, c));
    return [...new Set(moves)]; // Return unique moves
}

function getJumpsForPiece(board: Board, r: number, c: number): Move[] {
    const piece = board[r][c];
    if (!piece) return [];
    const jumps: Move[] = [];
    const moveDirs = getMoveDirections(piece);
    
    for (const [dr, dc] of moveDirs) {
        const newR = r + dr, newC = c + dc;
        if (isValidSquare(newR, newC) && isOpponent(piece, board[newR][newC])) {
            const jumpR = newR + dr, jumpC = newC + dc;
            if (isValidSquare(jumpR, jumpC) && board[jumpR][jumpC] === EMPTY) {
                jumps.push({ from: [r, c], to: [jumpR, jumpC] });
            }
        }
    }
    return jumps;
}

function getMoveDirections(piece: Piece): [number, number][] {
    if (piece === PLAYER_1_PIECE) return [[-1, -1], [-1, 1]];
    if (piece === PLAYER_2_PIECE) return [[1, -1], [1, 1]];
    if (piece === PLAYER_1_KING || piece === PLAYER_2_KING) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return [];
}

function isValidSquare(r: number, c: number): boolean {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function isOpponent(piece: Piece, otherPiece: SquareContent): boolean {
    if (!otherPiece) return false;
    const isP1 = piece === PLAYER_1_PIECE || piece === PLAYER_1_KING;
    const isP2 = otherPiece === PLAYER_2_PIECE || otherPiece === PLAYER_2_KING;
    return isP1 !== isP2;
}

function applyMove(board: Board, move: Move): Board {
    const newBoard = JSON.parse(JSON.stringify(board));
    const { from, to } = move;
    const piece = newBoard[from[0]][from[1]];
    newBoard[to[0]][to[1]] = piece;
    newBoard[from[0]][from[1]] = EMPTY;

    if (Math.abs(from[0] - to[0]) === 2) {
        const capturedRow = from[0] + (to[0] - from[0]) / 2;
        const capturedCol = from[1] + (to[1] - from[1]) / 2;
        newBoard[capturedRow][capturedCol] = EMPTY;
    }

    if (to[0] === 0 && piece === PLAYER_1_PIECE) newBoard[to[0]][to[1]] = PLAYER_1_KING;
    if (to[0] === 7 && piece === PLAYER_2_PIECE) newBoard[to[0]][to[1]] = PLAYER_2_KING;

    return newBoard;
}

function checkForWinner(board: Board, playerOnTurn: PlayerRole): PlayerRole | null {
    if (getAllValidMoves(board, playerOnTurn).length === 0) {
        return playerOnTurn === PLAYER_1_PIECE ? PLAYER_2_PIECE : PLAYER_1_PIECE;
    }
    return null;
}

// --- UI & RENDERING ---

function renderBoard() {
    if (!gameState) return;
    boardElement.innerHTML = '';
    
    const isMyTurn = gameState.currentPlayer === localPlayerRole;
    boardContainer.classList.toggle('disabled', !isMyTurn || gameState.isGameOver);

    const validMoveTargets = validMovesForSelectedPiece.map(m => {
        const to = getPlayerViewCoords(m.to[0], m.to[1]);
        return to.join(',');
    });

    for (let r_view = 0; r_view < 8; r_view++) {
        for (let c_view = 0; c_view < 8; c_view++) {
            const square = document.createElement('div');
            square.classList.add('square', (r_view + c_view) % 2 === 0 ? 'light' : 'dark');

            const [r_model, c_model] = getModelCoords(r_view, c_view);
            square.dataset.row = r_model.toString();
            square.dataset.col = c_model.toString();
            
            const piece = gameState.board[r_model]?.[c_model];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.classList.add('piece');
                const type = (piece === PLAYER_1_PIECE || piece === PLAYER_1_KING) ? 'player' : 'opponent';
                pieceElement.classList.add(type);
                if (piece === PLAYER_1_KING || piece === PLAYER_2_KING) pieceElement.classList.add('king');
                
                if (selectedPiece?.row === r_model && selectedPiece?.col === c_model) {
                    pieceElement.classList.add('selected');
                }
                square.appendChild(pieceElement);
            }

            if (validMoveTargets.includes(`${r_view},${c_view}`)) {
                const moveIndicator = document.createElement('div');
                moveIndicator.classList.add('valid-move-indicator');
                square.appendChild(moveIndicator);
            }
            boardElement.appendChild(square);
        }
    }
}

function updateStatus(text?: string) {
    if (text) { // Allow overriding status
        statusDisplay.textContent = text;
        return;
    }
    if (!gameState) {
        statusDisplay.textContent = 'Loading...';
        return;
    }
    if (gameState.isGameOver) {
        const winnerName = gameState.winner === localPlayerRole ? "You" : getOpponentName();
        statusDisplay.textContent = `${winnerName} Win${winnerName === 'You' ? '' : 's'}!`;
        return;
    }
    const isMyTurn = gameState.currentPlayer === localPlayerRole;
    statusDisplay.textContent = isMyTurn ? "Your Turn" : `Waiting for ${getOpponentName()}'s move...`;
}

function displayChatMessage(senderName: string, text: string) {
    const messageEl = document.createElement('div');
    messageEl.classList.add('chat-message');
    
    const localPlayerName = localPlayerRole === PLAYER_1_PIECE ? gameState?.player1Name : gameState?.player2Name;
    const type = senderName === localPlayerName ? 'sent' : 'received';
    messageEl.classList.add(type);
    
    const senderEl = document.createElement('strong');
    senderEl.textContent = senderName;

    const textEl = document.createElement('span');
    textEl.textContent = text;
    
    messageEl.appendChild(senderEl);
    messageEl.appendChild(textEl);
    
    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getPlayerViewCoords(r_model: number, c_model: number): [number, number] {
    if (localPlayerRole === PLAYER_1_PIECE) {
        return [r_model, c_model];
    } else {
        return [7 - r_model, 7 - c_model];
    }
}

function getModelCoords(r_view: number, c_view: number): [number, number] {
    if (localPlayerRole === PLAYER_1_PIECE) {
        return [r_view, c_view];
    } else {
        return [7 - r_view, 7 - c_view];
    }
}

// --- EVENT HANDLERS & GAME FLOW ---

async function finalizeTurn(newBoard: Board, lastMove: Move) {
    if (!gameState) return;
    gameState.board = newBoard;
    const isJump = Math.abs(lastMove.from[0] - lastMove.to[0]) === 2;

    // Check for multi-jumps
    if (isJump) {
        const nextJumps = getJumpsForPiece(newBoard, lastMove.to[0], lastMove.to[1]);
        if (nextJumps.length > 0) {
            // The current player's turn continues for another jump
            selectedPiece = { row: lastMove.to[0], col: lastMove.to[1] };
            validMovesForSelectedPiece = nextJumps;
            renderBoard();
            return; // End here, do not switch player
        }
    }
    
    // Turn is over, switch player
    gameState.currentPlayer = gameState.currentPlayer === PLAYER_1_PIECE ? PLAYER_2_PIECE : PLAYER_1_PIECE;
    
    // Check for winner
    gameState.winner = checkForWinner(gameState.board, gameState.currentPlayer);
    gameState.isGameOver = !!gameState.winner;

    // Send state update
    await sendGameMessage(gameState.gameId, { type: 'game_state', payload: gameState });
}

function handleIncomingMessage(message: GameMessage) {
    if (message.type === 'player_join' && localPlayerRole === PLAYER_1_PIECE) {
        if (gameState && !gameState.player2Name) {
            gameState.player2Name = message.payload.playerName;
            showGameScreen();
            sendGameMessage(gameState.gameId, { type: 'game_state', payload: gameState });
        }
    } else if (message.type === 'game_state') {
        const wasWaiting = !gameState?.player2Name && !!message.payload.player2Name;
        gameState = message.payload;
        if (wasWaiting) {
            showGameScreen();
        }
        selectedPiece = null;
        validMovesForSelectedPiece = [];
        renderBoard();
        updateStatus();
    } else if (message.type === 'chat_message') {
        displayChatMessage(message.payload.senderName, message.payload.text);
    }
}

async function handleSquareClick(e: Event) {
    if (!gameState || gameState.isGameOver || gameState.currentPlayer !== localPlayerRole) return;

    const target = e.currentTarget as HTMLDivElement;
    const row = parseInt(target.dataset.row!, 10);
    const col = parseInt(target.dataset.col!, 10);

    // Attempt to make a move
    const move = validMovesForSelectedPiece.find(m => m.to[0] === row && m.to[1] === col);
    if (move) {
        const newBoard = applyMove(gameState.board, move);
        selectedPiece = null;
        validMovesForSelectedPiece = [];
        await finalizeTurn(newBoard, move);
        return;
    }

    // Select a piece
    const playerPieces = localPlayerRole === PLAYER_1_PIECE ? [PLAYER_1_PIECE, PLAYER_1_KING] : [PLAYER_2_PIECE, PLAYER_2_KING];
    const pieceAtClick = gameState.board[row][col];
    if (pieceAtClick && playerPieces.includes(pieceAtClick as Piece)) {
        selectedPiece = { row, col };
        const allPlayerMoves = getAllValidMoves(gameState.board, localPlayerRole);
        validMovesForSelectedPiece = allPlayerMoves.filter(m => m.from[0] === row && m.from[1] === col);
        renderBoard();
    } else {
        selectedPiece = null;
        validMovesForSelectedPiece = [];
        renderBoard();
    }
}

function handleCreateGame(name: string) {
    localPlayerRole = PLAYER_1_PIECE;
    const gameId = Math.random().toString(36).substring(2, 8);
    window.location.hash = gameId;
    
    gameState = {
        gameId,
        board: createInitialBoard(),
        currentPlayer: PLAYER_1_PIECE,
        player1Name: name,
        player2Name: null,
        isGameOver: false,
        winner: null,
    };
    
    listenForGameEvents(gameId);
    showWaitingRoom();
}

function handleJoinGame(gameId: string, name: string) {
    localPlayerRole = PLAYER_2_PIECE;
    listenForGameEvents(gameId);
    sendGameMessage(gameId, { type: 'player_join', payload: { playerName: name } });
    updateStatus('Joining game...');
    showScreen('game'); // Tentatively show game screen
}

// --- SCREEN MANAGEMENT ---
function showScreen(screen: 'lobby' | 'waiting' | 'game') {
    lobbyContainer.classList.add('hidden');
    waitingRoomContainer.classList.add('hidden');
    gameContent.classList.add('hidden');
    if (screen === 'lobby') lobbyContainer.classList.remove('hidden');
    if (screen === 'waiting') waitingRoomContainer.classList.remove('hidden');
    if (screen === 'game') gameContent.classList.remove('hidden');
}

function showWaitingRoom() {
    shareLinkInput.value = window.location.href;
    showScreen('waiting');
}

function showGameScreen() {
    if (!gameState || !localPlayerRole) return;

    const isP1 = localPlayerRole === PLAYER_1_PIECE;
    player1Label.textContent = `${isP1 ? gameState.player1Name + " (You)" : gameState.player1Name} (Red)`;
    player2Label.textContent = `${!isP1 ? (gameState.player2Name ?? 'You') + " (You)" : (gameState.player2Name ?? 'Opponent')} (Black)`;
    chatContainer.classList.remove('hidden');

    showScreen('game');
    renderBoard();
    updateStatus();
}

function getOpponentName(): string {
    if (!gameState) return 'Opponent';
    return localPlayerRole === PLAYER_1_PIECE ? (gameState.player2Name ?? 'Opponent') : gameState.player1Name;
}

// --- INITIALIZATION ---
function init() {
    nameForm.addEventListener('submit', (e: SubmitEvent) => {
        e.preventDefault();
        const name = playerNameInput.value.trim();
        if (!name) return;
        
        const gameId = window.location.hash.substring(1);
        if (gameId) {
            handleJoinGame(gameId, name);
        } else {
            handleCreateGame(name);
        }
    });

    copyLinkButton.addEventListener('click', () => {
        shareLinkInput.select();
        document.execCommand('copy');
        copyLinkButton.textContent = 'Copied!';
        setTimeout(() => { copyLinkButton.textContent = 'Copy'; }, 2000);
    });
    
    resetButton.addEventListener('click', () => window.location.href = window.location.pathname);

    boardElement.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const square = target.closest('.square');
        if (square) {
            handleSquareClick({ currentTarget: square } as any);
        }
    });

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text && gameState) {
            const senderName = localPlayerRole === PLAYER_1_PIECE ? gameState.player1Name : (gameState.player2Name ?? 'Player 2');
            const message: GameMessage = {
                type: 'chat_message',
                payload: { senderName, text }
            };
            sendGameMessage(gameState.gameId, message);
            // Also display locally immediately
            displayChatMessage(senderName, text);
            chatInput.value = '';
        }
    });
    
    const gameId = window.location.hash.substring(1);
    if(gameId) {
        playerNameInput.focus();
        playFriendButton.textContent = 'Join Game';
    }
    showScreen('lobby');
}

init();