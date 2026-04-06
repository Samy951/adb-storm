import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthForm } from '../../components/auth-form/auth-form';

@Component({
  selector: 'app-auth-user',
  standalone:true,
  imports: [CommonModule, AuthForm],
  templateUrl: './auth-user.html',
  styleUrl: './auth-user.scss',
})
export class AuthUser {
  mode: "login" | "register" = "login";
  switchMode(){
    this.mode = this.mode === "login" ? "register" : "login"
  }
}
