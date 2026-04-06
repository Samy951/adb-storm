import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatHome } from './chat-home';

describe('ChatHome', () => {
  let component: ChatHome;
  let fixture: ComponentFixture<ChatHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatHome]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChatHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
