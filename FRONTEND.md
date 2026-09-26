# Chat backend: frontend integration guide

This guide documents the HTTP and Socket.IO interfaces implemented by this backend. The HTTP API is mounted at `/api/v1`; realtime chat uses the Socket.IO namespace `/message`.

## Environments

Use the backend origin as `API_ORIGIN` (for example, `http://localhost:3000` in local development). The backend port comes from `PORT` and defaults to `3000`. The backend must be configured with its MongoDB, JWT, CORS, and ImageKit settings. Keep backend secrets out of frontend code.

For browser requests that use the auth cookies, send credentials (`credentials: "include"` with `fetch` or `withCredentials: true` with Axios). The backend enables credentialed CORS for its configured `CORS_ORIGIN`.

## Authentication

Register and login are public. Protected HTTP routes accept either the access-token cookie or:

```http
Authorization: Bearer <accessToken>
```

Login returns the `accessToken` and `refreshToken` in its response data and sets them as `httpOnly`, `secure` cookies. The browser cannot read those cookies; use the response token if the client needs to pass the token explicitly to Socket.IO.

Socket connections also require the access token. Pass it in the Socket.IO `auth` object:

```js
import { io } from "socket.io-client";

const socket = io(`${API_ORIGIN}/message`, {
  auth: { token: accessToken },
});
```

An invalid or missing token rejects the connection with `connect_error` (`Unauthorized`). Refresh an expired access token with `POST /api/v1/users/refresh-token`, then reconnect the socket with the new access token.

## HTTP response format

Successful controller responses use this envelope:

```json
{
  "statusCode": 200,
  "message": "Success message",
  "data": {},
  "success": true
}
```

The type of `data` depends on the endpoint. Handle non-2xx responses as errors; the backend does not currently define a single custom JSON error envelope for every Express or upload error.

## User API

All paths below include the `/api/v1/users` prefix.

| Method and path | Auth | Request |
| --- | --- | --- |
| `POST /register` | No | `multipart/form-data`: `fullname`, `username`, `email`, `password`, and required file `avatar`. `coverImage` is accepted by the upload parser but is not stored. |
| `POST /login` | No | JSON: `{ "username": "...", "email": "...", "password": "..." }`. Provide a username or email and a password. |
| `POST /logout` | Access token | No body required. |
| `POST /refresh-token` | Refresh token | Refresh-token cookie or JSON `{ "refreshToken": "..." }`. |
| `POST /change-password` | Access token | JSON: `{ "oldPassword": "...", "newPassword": "..." }`. |
| `GET /current-user` | Access token | No body. |
| `PATCH /update-account` | Access token | JSON with `fullname` and/or `email`. |
| `PATCH /avatar-image` | Access token | `multipart/form-data`, file field `avatar`. |
| `PATCH /bio` | Access token | JSON: `{ "bio": "..." }`. |
| `GET /u/:username` | Access token | Returns the matching user's `fullname`, `username`, and `avatar`. |

Login response data contains `{ "user": ..., "accessToken": "...", "refreshToken": "..." }`. Registration and current-user responses return a user object in `data`.

## Conversations and groups

All paths below include the `/api/v1/messages` prefix and require an access token.

### List chats

`GET /conversations` returns groups and direct chats that have message history. The response data is an array:

- Group item: `{ type: "group", _id, name, members, createdBy, isGroup, lastMessage, ... }`
- Direct item: `{ type: "direct", userId, user, lastMessage }`, where `user` includes `_id`, `fullname`, `username`, and `avatar`.

Items are ordered by the latest message time. An empty direct chat is not included until at least one message exists. Group conversations without messages can be included with `lastMessage: null`.

### Create a group

`POST /groups`

```json
{
  "name": "Project team",
  "memberIds": ["<userId>", "<userId>"]
}
```

The current user is added automatically. The response `data` is the created conversation, including its `_id`; use that ID as the `conversationId` for group history and socket messages.

### Manage group members

Only the group creator can add or remove members.

- `POST /groups/:conversationId/members` with JSON `{ "memberIds": ["<userId>"] }` adds existing users. Existing members are left in place.
- `DELETE /groups/:conversationId/members/:userId` removes that member. The creator cannot be removed.

Both endpoints return the updated conversation in `data`.

## Message history

History endpoints return messages in chronological order within each page. They are cursor-paginated, with a default page size of 50 and a maximum of 100.

- Direct chat: `GET /:userId/messages?limit=50`
- Group chat: `GET /groups/:conversationId/messages?limit=50`

For an older page, pass the previous response's `data.nextCursor` as `before`:

```http
GET /<userId>/messages?limit=30&before=<nextCursor>
```

The response data is:

```json
{
  "messages": [],
  "hasMore": true,
  "nextCursor": "<messageId>"
}
```

When `hasMore` is false, there are no older messages and `nextCursor` is null. A cursor must identify a message in the requested chat.

Message documents include `_id`, `content`, `sender`, `receiver`, `conversation`, `recipients`, `isPending`, `UploadedFile`, `UploadedFileId`, `reactions`, `createdAt`, and `updatedAt`. Direct messages have a `receiver` and null `conversation`; group messages have a `conversation` and null `receiver`. Reactions in stored message documents are `{ "user": "<userId>", "value": "..." }` entries.

## Chat file upload

Upload a file before sending a message that references it:

`POST /api/v1/messages/chat-files-upload`

- Requires access-token authentication.
- Use `multipart/form-data` with one file field named `chatFile`.
- Maximum upload size is 25 MiB.
- Successful `data` includes `{ "url", "fileId", "name", "size", "mimeType" }`.

The upload endpoint stores the file in ImageKit; it does not create a chat message. Include `data.url` as `UploadedFile` and `data.fileId` as `UploadedFileId` in the Socket.IO `message` payload.

## Socket.IO events

Connect to `${API_ORIGIN}/message` with the authenticated `auth` object shown above. Listen for events as soon as the client connects.

### Send messages

Emit `message` with either a direct `receiverId` or a group `conversationId`. Use `content` for text; `message` is also accepted as an alias. At least text or an uploaded file URL is required.

```js
socket.emit("message", {
  receiverId: "<userId>",
  content: "Hello",
});

socket.emit("message", {
  conversationId: "<conversationId>",
  content: "Hello group",
  UploadedFile: "<file-url>",
  UploadedFileId: "<file-id>",
});
```

Events emitted by the backend:

- `message-sent`: saved message returned to its sender.
- `message`: saved message delivered to each recipient. Offline recipients receive queued messages when they next connect.
- `message-error`: `{ "message": "..." }` when sending fails.

Group messages are delivered to each online member and queued for offline members. Clients should use the saved message `_id` to avoid duplicate display when reconciling optimistic sends with `message-sent`.

### Presence

For an on-demand check, emit `isUserOnline` with `{ "receiverId": "<userId>" }`. The same socket receives `isUserOnline` with `{ "userId": "<userId>", "isOnline": true }`.

The namespace broadcasts `presence` on online/offline transitions:

```json
{ "userId": "<userId>", "isOnline": true }
```

The server tracks multiple active sockets per user and only broadcasts a transition when the user's overall online state changes.

### Reactions

Emit `message-reaction` with a message ID and a non-empty reaction string:

```js
socket.emit("message-reaction", {
  messageId: "<messageId>",
  reaction: "thumbs-up",
});
```

The backend saves one current reaction value per user per message. The reacting socket receives `message-reaction-updated`; other online participants receive `message-reaction`:

```json
{
  "senderId": "<userId>",
  "messageId": "<messageId>",
  "reactions": [
    { "userId": "<userId>", "value": "thumbs-up" }
  ]
}
```

Only participants in the direct chat or current members of the group may react. Failed updates emit `message-reaction-error` with `{ "message": "..." }`. Use the persisted `reactions` field returned in message history as the source of truth after reconnecting.

## Typical client flow

1. Register or log in, then retain the access token for HTTP and Socket.IO authentication.
2. Fetch `GET /api/v1/messages/conversations` and render the chats.
3. Fetch the first page of history for the selected direct or group chat.
4. Connect to `/message`; handle incoming `message`, `presence`, and `message-reaction` events.
5. Upload attachments over HTTP, then send the returned URL and file ID with the socket message.
6. When loading older history, request the next page using `before=data.nextCursor`.
