import { NgForOf } from '@angular/common';
import { Component, Input } from '@angular/core';
import { LucideAngularModule, MessageCircle, User, Send, Settings, LogOut, Video, Phone, Mic, Upload, ArrowLeft } from 'lucide-angular';

@Component({
  selector: 'app-chat-home',
  standalone: true,
  imports: [LucideAngularModule, NgForOf],
  templateUrl: './chat-home.html',
  styleUrl: './chat-home.scss',
})
export class ChatHome {
  readonly icons = {
    MessageCircle,
    User,
    Send,
    Phone,
    Settings,
    LogOut,
    Video,
    Mic,
    Upload,
    ArrowLeft,
  }

  chats = [
    {
      name: "Jonathan", message: "Bonjour", createdAt: "09:25",badge: 3
    },
    {
      name:"Mathis", message:"Bonjour, Comment vas-tu ?", createdAt: "09:45", badge: 1
    },
    {
      name:"Sophia", message:"I sent you the file",  createdAt: "09:45", badge: 4
    },
    {
      name:"Jordan", message:"Thank you bro.",  createdAt: "09:45", badge: 1
    },
    {
      name:"Jordanette", message:"Ok",  createdAt: "09:45", badge: 3
    },
    {
      name:"Jamile", message:"C'est magnifique",  createdAt: "09:45", badge: 2
    },
    {
      name:"Camile", message:"Au revoir",  createdAt: "19:45", badge: 1
    },
  ]

  @Input() chat !: any;
  @Input() active = false;

  selectedChat:any = null

  openChat(chat:any) {
    this.selectedChat = chat
  }

  closeChat(){
    this.selectedChat = null
  }

  activeIcon:string = "chat"
  setActiveIcon(icon: string){
    this.activeIcon = icon;
  }
}
