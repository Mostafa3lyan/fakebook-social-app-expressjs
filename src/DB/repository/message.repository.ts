import { IMessage } from "../../common/interfaces";
import { MessageModel } from "../models";
import { DatabaseRepository } from "./base.repository";

export class MessageRepository extends DatabaseRepository<IMessage> {
  constructor() {
    super(MessageModel);
  }
}

