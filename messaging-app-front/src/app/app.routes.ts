import { Routes } from '@angular/router';
import { HomePageComponent } from './features/home/pages/home-page';
import { AuthUser } from './features/auth/pages/auth-user/auth-user';
import { ChatHome } from './features/chat/pages/chat-home/chat-home';

export const routes: Routes = [
    {
        path: "", 
        component: HomePageComponent,
        pathMatch: "full",
    },
    {
        path: "auth",
        component: AuthUser,
    },
    {
        path: "chats",
        component: ChatHome,
    },
    {
        path: "**",
        redirectTo: "",
    },
];
