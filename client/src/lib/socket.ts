import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true, autoConnect: true });
  }
  return socket;
}

export function joinProject(projectId: string) {
  getSocket().emit('join-project', { projectId });
}

export function leaveProject() {
  socket?.emit('leave-project');
}

export function sendCursor(trackId: string, time: number) {
  socket?.emit('cursor:position', { trackId, time });
}

export interface OnlineUser {
  userId: string;
  displayName: string;
  color: string;
}
