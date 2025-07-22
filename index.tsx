/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// --- TYPE DEFINITIONS AND CONSTANTS ---
const PLAYER_PIECE = 'r'; // Player 1
const AI_PIECE = 'b'; // Player 2 (used as Player 2 identifier)
const PLAYER_KING = 'R';
const AI_KING = 'B';
const EMPTY = null;

type Piece = typeof PLAYER_PIECE | typeof AI_PIECE | typeof PLAYER_KING | typeof AI_KING;
type SquareContent = Piece | typeof EMPTY;
type Board = SquareContent[][];
type Move = { from: [number, number], to: [number, number] };
type PlayerRole = typeof PLAYER_PIECE | typeof AI_PIECE;

// Compact representation for URL state
type BoardForURL = (0 | 1 | 2 | 3 | 4)[]; // 0:E, 1:P, 2:A, 3:PK, 4:AK
interface GameStateForURL {
    b: BoardForURL,
    p1n: string,
    p2n: string,
    cp: PlayerRole,
    go: boolean,
    sp: { row: number, col: number } | null, // for multi-jump state
}

// --- DOM ELEMENTS ---
// Name Entry
const nameEntryContainer = document.getElementById('name-entry-container')!;
const nameForm = document.getElementById('name-form')!;
const player1NameInput = document.getElementById('player1-name') as HTMLInputElement;
const player2NameInput = document.getElementById('player2-name') as HTMLInputElement;

// Game Screen
const gameContent = document.getElementById('game-content')!;
const boardElement = document.getElementById('board')!;
const statusDisplay = document.getElementById('status-display')!;
const resetButton = document.getElementById('reset-button')!;
const player1Label = document.getElementById('player-1-label')!;
const player2Label = document.getElementById('player-2-label')!;

// Share Modal
const shareModalOverlay = document.getElementById('share-modal-overlay')!;
const shareModalTitle = document.getElementById('share-modal-title')!;
const shareModalText = document.getElementById('share-modal-text')!;
const shareLinkInput = document.getElementById('share-link-input') as HTMLInputElement;
const copyLinkButton = document.getElementById('copy-link-button')!;
const closeModalButton = document.getElementById('close-modal-button')!;

// --- GAME STATE (now managed via URL) ---
let boardState: Board = [];
let currentPlayer: PlayerRole = PLAYER_PIECE;
let selectedPiece: { row: number, col: number } | null = null;
let isGameOver = false;
let validMovesForSelectedPiece: Move[] = [];
let player1Name = 'Player 1';
let player2Name = 'Player 2';

// --- URL STATE MANAGEMENT ---

function serializeState(isNewGame = false): string {
    const boardForURL = boardState.flat().map(p => {
        if (p === PLAYER_PIECE) return 1;
        if (p === AI_PIECE) return 2;
        if (p === PLAYER_KING) return 3;
        if (p === AI_KING) return 4;
        return 0;
    }) as BoardForURL;

    const state: GameStateForURL = {
        b: boardForURL,
        p1n: player1Name,
        p2n: player2Name,
        cp: currentPlayer,
        go: isGameOver,
        sp: selectedPiece, // Store selected piece for multi-jump
    };

    return btoa(JSON.stringify(state));
}

function deserializeState(hash: string) {
    try {
        const json = atob(hash.substring(1));
        const state: GameStateForURL = JSON.parse(json);

        boardState = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
        for (let i = 0; i < 64; i++) {
            const row = Math.floor(i / 8);
            const col = i % 8;
            const p = state.b[i];
            if (p === 1) boardState[row][col] = PLAYER_PIECE;
            else if (p === 2) boardState[row][col] = AI_PIECE;
            else if (p === 3) boardState[row][col] = PLAYER_KING;
            else if (p === 4) boardState[row][col] = AI_KING;
            else boardState[row][col] = EMPTY;
        }

        player1Name = state.p1n;
        player2Name = state.p2n;
        currentPlayer = state.cp;
        isGameOver = state.go;
        selectedPiece = state.sp;

        if (selectedPiece) {
            validMovesForSelectedPiece = getJumpsForPiece(boardState, selectedPiece.row, selectedPiece.col);
        } else {
            validMovesForSelectedPiece = [];
        }

        return true;
    } catch (e) {
        console.error("Failed to parse game state from URL:", e);
        return false;
    }
}

function updateURLWithState(isNewGame = false) {
    const hash = serializeState(isNewGame);
    // This will trigger the 'hashchange' event listener
    window.location.hash = hash;
    // Show modal after state is set
    setTimeout(() => showShareModal(isNewGame), 0);
}

function loadGameFromURL() {
    const hash = window.location.hash;
    if (hash && deserializeState(hash)) {
        showGameScreen();
        player1Label.textContent = `${player1Name} (Red)`;
        player2Label.textContent = `${player2Name} (Black)`;
        renderBoard();

        if (isGameOver) {
            const winner = currentPlayer === PLAYER_PIECE ? player2Name : player1Name;
            updateStatus(`${winner} Wins!`);
        } else {
            updateStatus(`${currentPlayer === PLAYER_PIECE ? player1Name : player2Name}'s Turn`);
        }

    } else {
        showNameEntryScreen();
    }
}

// --- MODAL LOGIC ---
function showShareModal(isNewGame = false) {
    const opponentName = currentPlayer === PLAYER_PIECE ? player2Name : player1Name;
    shareLinkInput.value = window.location.href;
    
    if (isGameOver) {
        const winnerName = currentPlayer === PLAYER_PIECE ? player2Name : player1Name;
        shareModalTitle.textContent = 'Game Over!';
        shareModalText.textContent = `${winnerName} has won! Share the final board state:`;
    } else if (isNewGame) {
        shareModalTitle.textContent = 'Game Ready!';
        shareModalText.textContent = `Send this link to ${opponentName} to start the game!`;
    } else {
        shareModalTitle.textContent = `It's ${opponentName}'s Turn!`;
        shareModalText.textContent = `Send this link back to ${opponentName}:`;
    }
    copyLinkButton.textContent = 'Copy Link';
    shareModalOverlay.classList.remove('hidden');
}

function hideShareModal() {
    shareModalOverlay.classList.add('hidden');
}


// --- GAME LOGIC ---

function createInitialBoard(): Board {
    const board: Board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
    for (let i = 0; i < 8; i++) {
        if (i < 3) {
            for (let j = 0; j < 8; j++) {
                if ((i + j) % 2 !== 0) board[i][j] = AI_PIECE;
            }
        }
        if (i > 4) {
            for (let j = 0; j < 8; j++) {
                if ((i + j) % 2 !== 0) board[i][j] = PLAYER_PIECE;
            }
        }
    }
    return board;
}

function getAllValidMoves(board: Board, player: PlayerRole): Move[] {
    const allMoves: Move[] = [];
    const playerPieces = player === PLAYER_PIECE ? [PLAYER_PIECE, PLAYER_KING] : [AI_PIECE, AI_KING];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && playerPieces.includes(piece)) {
                const pieceMoves = getMovesForPiece(board, r, c);
                allMoves.push(...pieceMoves);
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
    for (const [dr, dc] of moveDirs) {
        const newR = r + dr, newC = c + dc;
        if (isValidSquare(newR, newC) && board[newR][newC] === EMPTY) {
            moves.push({ from: [r, c], to: [newR, newC] });
        } else if (isValidSquare(newR, newC) && isOpponent(piece, board[newR][newC])) {
            const jumpR = newR + dr, jumpC = newC + dc;
            if (isValidSquare(jumpR, jumpC) && board[jumpR][jumpC] === EMPTY) {
                moves.push({ from: [r, c], to: [jumpR, jumpC] });
            }
        }
    }
    return moves;
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
    if (piece === PLAYER_PIECE) return [[-1, -1], [-1, 1]];
    if (piece === AI_PIECE) return [[1, -1], [1, 1]];
    if (piece === PLAYER_KING || piece === AI_KING) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    return [];
}

function isValidSquare(r: number, c: number): boolean {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function isOpponent(piece: Piece, otherPiece: SquareContent): boolean {
    if (!otherPiece) return false;
    const isPlayerPiece = piece === PLAYER_PIECE || piece === PLAYER_KING;
    const isOtherPlayerPiece = otherPiece === PLAYER_PIECE || otherPiece === PLAYER_KING;
    return isPlayerPiece !== isOtherPlayerPiece;
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

    if (to[0] === 0 && piece === PLAYER_PIECE) newBoard[to[0]][to[1]] = PLAYER_KING;
    if (to[0] === 7 && piece === AI_PIECE) newBoard[to[0]][to[1]] = AI_KING;
    
    return newBoard;
}

function checkForWinner(board: Board, player: PlayerRole) {
    if (getAllValidMoves(board, player).length === 0) {
        return player === PLAYER_PIECE ? AI_PIECE : PLAYER_PIECE;
    }
    return null;
}

// --- UI & RENDERING ---

function renderBoard() {
    boardElement.innerHTML = '';
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = document.createElement('div');
            square.classList.add('square', (r + c) % 2 === 0 ? 'light' : 'dark');
            square.dataset.row = r.toString();
            square.dataset.col = c.toString();

            const piece = boardState[r]?.[c];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.classList.add('piece');
                const type = (piece === PLAYER_PIECE || piece === PLAYER_KING) ? 'player' : 'ai';
                pieceElement.classList.add(type);
                if (piece === PLAYER_KING || piece === AI_KING) pieceElement.classList.add('king');
                if (selectedPiece?.row === r && selectedPiece?.col === c) pieceElement.classList.add('selected');
                square.appendChild(pieceElement);
            }

            const isValidMove = validMovesForSelectedPiece.some(m => m.to[0] === r && m.to[1] === c);
            if (isValidMove) {
                const moveIndicator = document.createElement('div');
                moveIndicator.classList.add('valid-move-indicator');
                square.appendChild(moveIndicator);
            }
            boardElement.appendChild(square);
        }
    }
}

function updateStatus(text: string) {
    statusDisplay.textContent = text;
}

// --- EVENT HANDLERS & GAME FLOW ---

function handleSquareClick(e: Event) {
    if (isGameOver) return;

    const target = e.currentTarget as HTMLDivElement;
    const row = parseInt(target.dataset.row!, 10);
    const col = parseInt(target.dataset.col!, 10);

    const pieceAtClick = boardState[row][col];
    const playerPieces = currentPlayer === PLAYER_PIECE ? [PLAYER_PIECE, PLAYER_KING] : [AI_PIECE, AI_KING];

    const move = validMovesForSelectedPiece.find(m => m.to[0] === row && m.to[1] === col);
    if (move) {
        boardState = applyMove(boardState, move);
        const isJump = Math.abs(move.from[0] - move.to[0]) === 2;

        if (isJump) {
            const nextJumps = getJumpsForPiece(boardState, move.to[0], move.to[1]);
            if (nextJumps.length > 0) {
                // Continue turn for multi-jump
                selectedPiece = { row: move.to[0], col: move.to[1] };
                updateURLWithState(); // Update URL for multi-jump state
                return; 
            }
        }
        
        selectedPiece = null;
        const nextPlayer = currentPlayer === PLAYER_PIECE ? AI_PIECE : PLAYER_PIECE;
        const winner = checkForWinner(boardState, nextPlayer);

        if (winner) {
            isGameOver = true;
        } else {
            currentPlayer = nextPlayer;
        }
        updateURLWithState();
        return;
    }

    if (pieceAtClick && playerPieces.includes(pieceAtClick as Piece)) {
        selectedPiece = { row, col };
        const allPlayerMoves = getAllValidMoves(boardState, currentPlayer);
        validMovesForSelectedPiece = allPlayerMoves.filter(m => m.from[0] === row && m.from[1] === col);
        renderBoard();
    } else {
        selectedPiece = null;
        validMovesForSelectedPiece = [];
        renderBoard();
    }
}

function resetGame() {
    window.location.hash = '';
    if (window.location.href.includes('#')) {
       window.location.href = window.location.href.split('#')[0];
    }
    showNameEntryScreen();
}

function showNameEntryScreen() {
    nameEntryContainer.classList.remove('hidden');
    gameContent.classList.add('hidden');
    player1NameInput.value = '';
    player2NameInput.value = '';
}

function showGameScreen() {
    nameEntryContainer.classList.add('hidden');
    gameContent.classList.remove('hidden');
}

// --- INITIALIZATION ---
function init() {
    window.addEventListener('hashchange', loadGameFromURL);
    loadGameFromURL(); // Load state on initial page load

    nameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        player1Name = player1NameInput.value.trim() || 'Player 1';
        player2Name = player2NameInput.value.trim() || 'Player 2';
        
        boardState = createInitialBoard();
        currentPlayer = PLAYER_PIECE;
        isGameOver = false;
        selectedPiece = null;
        validMovesForSelectedPiece = [];
        
        updateURLWithState(true); // Create the first game link
    });

    resetButton.addEventListener('click', resetGame);
    closeModalButton.addEventListener('click', hideShareModal);

    copyLinkButton.addEventListener('click', () => {
        shareLinkInput.select();
        navigator.clipboard.writeText(shareLinkInput.value).then(() => {
            copyLinkButton.textContent = 'Copied!';
        });
    });

    boardElement.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const square = target.closest('.square');
        if (square) {
            handleSquareClick({ currentTarget: square } as any);
        }
    });
}

init();
