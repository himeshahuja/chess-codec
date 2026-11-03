# Chess Codec

Hide an image inside a chess game. Every move carries `floor(log2 n)` bits, where `n` is the number of legal moves (sorted alphabetically) in that position. Replay the game and the image comes back. Edit a move and see exactly which bits and pixels change.

Live: https://himeshahuja.github.io/chess-codec/

```
npm install
npm run dev
npm test
```
